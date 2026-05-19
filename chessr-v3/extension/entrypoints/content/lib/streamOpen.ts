/**
 * Tracks whether the Stream Mode page is currently open in any tab.
 *
 * Two consumers:
 *   - Stream page (`stream/StreamApp.tsx`) writes `true` on mount and
 *     `false` on unmount.
 *   - Content scripts (per-platform) read it via `useStreamOpen()` to
 *     hide their on-page panel — when the streamer has Stream Mode open
 *     they show nothing on chess.com / lichess / worldchess, everything
 *     happens in the dedicated tab.
 *
 * Background script also clears the flag in `tabs.onRemoved` as a
 * safety net: if the stream tab crashes or closes without firing the
 * page-level cleanup, the flag would otherwise be stuck `true` and
 * the platform panel would stay invisible.
 *
 * Storage shape: `{ chessr_stream_open: { value: boolean, ts: number, tabId: number } }`.
 * The tabId lets the background know which tab "owns" the open state.
 */

import { useEffect, useState } from 'react';

const KEY = 'chessr_stream_open';

interface StreamOpenFlag {
  value: boolean;
  ts: number;
  tabId?: number;
}

/** Set the flag. Called by the stream page on mount/unmount. */
export async function setStreamOpen(value: boolean, tabId?: number): Promise<void> {
  await browser.storage.local.set({
    [KEY]: { value, ts: Date.now(), tabId } as StreamOpenFlag,
  });
}

/** Read the current flag. */
export async function getStreamOpen(): Promise<boolean> {
  const res = await browser.storage.local.get(KEY);
  return !!(res as Record<string, StreamOpenFlag>)[KEY]?.value;
}

/** React hook for content scripts. Subscribes to changes so the panel
 *  hides/reveals reactively when the streamer opens or closes the
 *  Stream Mode tab. Seeds initial state from the sync cache (which
 *  is itself seeded from localStorage at module load) so the very
 *  first render doesn't flash the on-page UI on a stream-mode tab. */
export function useStreamOpen(): boolean {
  const [open, setOpen] = useState<boolean>(() => isStreamOpen());

  useEffect(() => {
    let alive = true;
    browser.storage.local.get(KEY).then((res) => {
      const flag = (res as Record<string, StreamOpenFlag>)[KEY];
      if (alive) setOpen(!!flag?.value);
    });

    const onChanged = (changes: Record<string, browser.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      const change = changes[KEY];
      if (!change) return;
      const next = (change.newValue as StreamOpenFlag | undefined)?.value ?? false;
      setOpen(next);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return open;
}

export const STREAM_OPEN_STORAGE_KEY = KEY;

// ─── Sync cache for non-React consumers ────────────────────────────────
// Some content-script subscriptions (e.g. arrow rendering on the chess
// board) need a synchronous read of the stream-open flag — they can't
// `await getStreamOpen()` mid-render.
//
// MV3 `browser.storage.local` is async-only, so on every content-script
// restart there's a window between page boot and the storage promise
// resolving where the cache returns the stale-or-default value. That's
// the bug behind the "arrows reappear on new game with Stream Mode on":
// chess.com replaces the board DOM, the content script re-evaluates,
// renderArrows runs, but `isStreamOpen()` answers `false` because the
// async read hasn't landed yet.
//
// Fix: mirror the flag into `window.localStorage` (synchronous). On
// boot we seed `cachedValue` from localStorage first, then refresh from
// browser.storage.local in case the localStorage copy was stale.
const LOCAL_STORAGE_KEY = 'chessr.streamOpen';

function readLocalStorage(): boolean | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw === null) return null;
    return raw === '1';
  } catch {
    return null;
  }
}

function writeLocalStorage(value: boolean): void {
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, value ? '1' : '0');
  } catch { /* private mode / quota — ignore */ }
}

// Seed synchronously at module-load so the very first isStreamOpen()
// call (which can fire BEFORE initStreamOpenCache returns) sees the
// real value mirrored from a previous session.
let cachedValue: boolean = readLocalStorage() ?? false;
let initialized = false;
// True once the async chrome.storage.local read has resolved at least
// once. Used by callers that want to skip rendering during the boot
// window — see streamOpenReady() below.
let asyncReadyResolved = false;
type StreamOpenListener = (open: boolean) => void;
const listeners = new Set<StreamOpenListener>();

/** Synchronous read. Seeded from localStorage at module-load, kept in
 *  sync via browser.storage.onChanged so cross-tab updates propagate. */
export function isStreamOpen(): boolean {
  return cachedValue;
}

/** Returns true once the cross-tab chrome.storage.local read has
 *  resolved at least once. Renderers that absolutely cannot leak a
 *  flash of arrows on a stream-mode tab gate on this — render
 *  paths run on first move from the engine, which is ~always after
 *  this flag flips, but the safety net costs nothing. */
export function streamOpenReady(): boolean {
  return asyncReadyResolved;
}

/** Subscribe to changes (non-React). Returns an unsubscribe function. */
export function subscribeStreamOpen(fn: StreamOpenListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setCache(next: boolean, force = false): void {
  if (!force && next === cachedValue) return;
  cachedValue = next;
  writeLocalStorage(next);
  listeners.forEach((l) => l(cachedValue));
}

/** Initialize the cache + subscription. Idempotent. Safe to call from
 *  every content-script entrypoint — the listener is bound once. */
export function initStreamOpenCache(): void {
  if (initialized) return;
  initialized = true;

  // Refresh from chrome.storage in case the localStorage seed was stale
  // (e.g. the user toggled Stream Mode in another tab while this tab
  // was closed). storage.local is the cross-tab source of truth.
  browser.storage.local.get(KEY).then((res) => {
    const flag = (res as Record<string, StreamOpenFlag>)[KEY];
    const next = !!flag?.value;
    // Force-notify on the first resolution even if value matches the
    // localStorage seed — downstream subscribers (e.g. the
    // clearArrows hook in content.tsx) treat this as the canonical
    // "we now know the truth, act on it" signal. Without the force
    // we'd miss the case where chess.com tab cold-starts WHILE stream
    // mode is already open in another tab: localStorage was empty →
    // cachedValue defaulted false → storage read returns true → flip
    // notifies → renderers clear. But if localStorage already had the
    // right value, no flip happened and the subscribers never fire to
    // re-evaluate, leaving any in-flight render in a wrong state.
    setCache(next, /* force */ true);
    asyncReadyResolved = true;
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[KEY];
    if (!change) return;
    const next = (change.newValue as StreamOpenFlag | undefined)?.value ?? false;
    setCache(next);
  });
}
