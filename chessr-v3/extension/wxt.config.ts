import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Chessr — Chess Companion',
    description: 'Real-time chess assistant. Get move suggestions, analyze positions, and improve your game on Chess.com and Lichess.',
    version: '3.0.0',
    icons: {
      16: '/icons/icon16.png',
      48: '/icons/icon48.png',
      128: '/icons/icon128.png',
    },
    permissions: ['storage', 'activeTab', 'declarativeNetRequest'],
    declarative_net_request: {
      rule_resources: [
        {
          id: 'ruleset_1',
          enabled: true,
          path: '/rules.json',
        },
      ],
    },
    host_permissions: [
      '*://chess.com/*',
      '*://*.chess.com/*',
      '*://lichess.org/*',
      '*://*.lichess.org/*',
      '*://app.chessr.io/*',
    ],
    web_accessible_resources: [
      {
        resources: ['/icons/*', '/engine/*', '/icons/cls-*.svg'],
        matches: ['*://chess.com/*', '*://*.chess.com/*', '*://lichess.org/*', '*://*.lichess.org/*'],
      },
    ],
  },
});
