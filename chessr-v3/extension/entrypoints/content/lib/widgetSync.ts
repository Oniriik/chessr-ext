/**
 * Mirror the system-message widget state across the chess.com content
 * script and the dedicated Stream Mode tab via chrome.storage.local.
 *
 * Stream Mode hides the chessr UI from the host page (so the streamer's
 * audience doesn't see private notifications). System messages should
 * still reach the streamer — just on the dedicated tab they look at.
 *
 * Mirror surface is intentionally small: just `current` (queue stays
 * per-tab, MVP). Last-write-wins via chrome.storage handles dismiss
 * conflicts naturally; an in-memory equality guard prevents the
 * subscribe → write → onChanged → set → subscribe → … echo loop.
 */

import { useWidgetStore, type SystemMessage } from '../stores/widgetStore';

const KEY = 'chessr_widget';
let installed = false;
let lastSeenId: string | null = null;

export function installWidgetSync(): void {
  if (installed) return;
  installed = true;

  // Push: any local change to widgetStore.current → write to storage,
  // unless it matches what we last received (echo).
  useWidgetStore.subscribe((state) => {
    const id = state.current?.id ?? null;
    if (id === lastSeenId) return;
    lastSeenId = id;
    browser.storage.local.set({
      [KEY]: { current: state.current },
    }).catch((err) => {
      console.warn('[widgetSync] write failed:', err);
    });
  });

  // Initial pull — if a peer already wrote state before we attached,
  // hydrate from it.
  browser.storage.local.get(KEY).then((res) => {
    const v = (res as Record<string, { current?: SystemMessage | null } | undefined>)[KEY];
    if (!v) return;
    const next = v.current ?? null;
    if (next?.id === useWidgetStore.getState().current?.id) return;
    lastSeenId = next?.id ?? null;
    if (next) useWidgetStore.setState({ current: next });
  });

  // Pull: any storage change → apply locally, but `null` payloads call
  // next() instead of plain setState so a per-tab queue gets a chance
  // to promote its head when the peer dismissed the previous head.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[KEY];
    if (!change) return;
    const next = (change.newValue as { current?: SystemMessage | null } | undefined)?.current ?? null;
    const local = useWidgetStore.getState();
    if ((next?.id ?? null) === (local.current?.id ?? null)) return;
    lastSeenId = next?.id ?? null;
    if (next === null) local.next();
    else useWidgetStore.setState({ current: next });
  });
}
