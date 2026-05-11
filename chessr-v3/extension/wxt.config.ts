import { defineConfig } from "wxt";
import { runPostbuild } from "./scripts/postbuild.js";

// PROD_BUILD=1 reuses the beta env (same Supabase, same backend URL)
// but strips the [BETA] prefix everywhere so we can publish to the
// Chrome Web Store from the same backend the beta has been validated
// against. Set via `npm run build:prod`.
const isProd = process.env.PROD_BUILD === "1";
const isBeta = process.argv.includes("beta") && !isProd;
const displayName = isBeta ? "[BETA] Chessr.io" : "Chessr.io";
// Zip filename uses the lowercase "chessr" prefix on prod builds so the
// uploaded artifact matches the public download URL scheme.
const zipName = isProd ? "chessr" : displayName;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: {
    name: zipName,
    artifactTemplate: "{{name}} v{{version}}.zip",
  },
  hooks: {
    "build:done": async () => {
      await runPostbuild();
    },
  },
  manifest: {
    name: isBeta
      ? "[BETA] Chessr.io — Chess assist done right!"
      : "Chessr.io — Chess assist done right!",
    description: isBeta ? "Chessr.io v3 BETA" : "Chessr.io v3",
    version: "3.2.0",
    icons: {
      16: "/icons/icon16.png",
      48: "/icons/icon48.png",
      128: "/icons/icon128.png",
    },
    permissions: ["storage", "activeTab", "declarativeNetRequest", "debugger"],
    declarative_net_request: {
      rule_resources: [
        {
          id: "ruleset_1",
          enabled: true,
          path: "/rules.json",
        },
      ],
    },
    host_permissions: [
      "*://chess.com/*",
      "*://*.chess.com/*",
      "*://lichess.org/*",
      "*://*.lichess.org/*",
      "*://worldchess.com/*",
      "*://*.worldchess.com/*",
      "*://app.chessr.io/*",
    ],
    web_accessible_resources: [
      {
        resources: ["/icons/*", "/engine/*", "/icons/cls-*.svg"],
        matches: [
          "*://chess.com/*",
          "*://*.chess.com/*",
          "*://lichess.org/*",
          "*://*.lichess.org/*",
          "*://worldchess.com/*",
          "*://*.worldchess.com/*",
        ],
      },
    ],
  },
});
