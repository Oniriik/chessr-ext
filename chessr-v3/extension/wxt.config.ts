import { defineConfig } from "wxt";
import { runPostbuild } from "./scripts/postbuild.js";

const isBeta = process.argv.includes("beta");
const displayName = isBeta ? "[BETA] Chessr.io" : "Chessr.io";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: {
    name: displayName,
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
    version: "3.0.2",
    icons: {
      16: "/icons/icon16.png",
      48: "/icons/icon48.png",
      128: "/icons/icon128.png",
    },
    permissions: ["storage", "activeTab", "declarativeNetRequest"],
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
        ],
      },
    ],
  },
});
