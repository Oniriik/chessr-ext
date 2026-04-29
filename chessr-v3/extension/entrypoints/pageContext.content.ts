/**
 * Bootstrap for the MAIN-world page-context script.
 *
 * Responsibility:
 *   1. Pick the right PageContextAdapter for the current hostname (chess.com,
 *      lichess.org, …) and let it install its hooks + emit `chessr:*` events.
 *   2. Route `chessr:executeMove` / `chessr:executePremove` /
 *      `chessr:cancelPremoves` / `chessr:rematch` postMessages from the
 *      ISOLATED-world content script back into the adapter.
 *
 * Anonymisation and fake-title features ship as separate chess.com-only
 * entrypoints (`chesscomAnon.content.ts`, `chesscomFakeTitle.content.ts`).
 */

import { pickPageAdapter } from './content/adapters';

export default defineContentScript({
  matches: [
    '*://chess.com/*',
    '*://*.chess.com/*',
    '*://lichess.org/*',
    '*://*.lichess.org/*',
  ],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    const adapter = pickPageAdapter(location.hostname);
    if (!adapter) return;

    const emit = (msg: unknown) => window.postMessage(msg, '*');
    adapter.install(emit);

    window.addEventListener('message', (e) => {
      const data = e.data;
      if (typeof data?.type !== 'string') return;
      if (!data.type.startsWith('chessr:')) return;

      switch (data.type) {
        case 'chessr:executeMove':
          adapter.executeMove(data.move, data.humanize ?? undefined);
          break;
        case 'chessr:executePremove':
          adapter.executePremove(data.move);
          break;
        case 'chessr:cancelPremoves':
          adapter.cancelPremoves();
          break;
        case 'chessr:rematch':
          adapter.requestRematch();
          break;
        case 'chessr:requestState':
          adapter.requestState?.();
          break;
      }
    });
  },
});
