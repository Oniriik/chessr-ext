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
 *  Stream Mode tab. */
export function useStreamOpen(): boolean {
  const [open, setOpen] = useState(false);

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
// `await getStreamOpen()` mid-render. We mirror the storage value into
// a module-level boolean kept in sync via storage.onChanged.
let cachedValue = false;
let initialized = false;
type StreamOpenListener = (open: boolean) => void;
const listeners = new Set<StreamOpenListener>();

/** Synchronous read. Returns the last known value; will be `false` until
 *  initStreamOpenCache() has resolved its initial read. */
export function isStreamOpen(): boolean {
  return cachedValue;
}

/** Subscribe to changes (non-React). Returns an unsubscribe function. */
export function subscribeStreamOpen(fn: StreamOpenListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Initialize the cache + subscription. Idempotent. Safe to call from
 *  every content-script entrypoint — the listener is bound once. */
export function initStreamOpenCache(): void {
  if (initialized) return;
  initialized = true;

  browser.storage.local.get(KEY).then((res) => {
    const flag = (res as Record<string, StreamOpenFlag>)[KEY];
    const next = !!flag?.value;
    if (next !== cachedValue) {
      cachedValue = next;
      listeners.forEach((l) => l(cachedValue));
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[KEY];
    if (!change) return;
    const next = (change.newValue as StreamOpenFlag | undefined)?.value ?? false;
    if (next === cachedValue) return;
    cachedValue = next;
    listeners.forEach((l) => l(cachedValue));
  });
}
