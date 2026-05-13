import { defineConfig } from "wxt";

const isProd = process.env.PROD_BUILD === "1";
const isBeta = process.argv.includes("beta") && !isProd;

const displayName = isBeta
  ? "[BETA] Chessr - Review Unlocker"
  : "Chessr - Review Unlocker";

const zipName = isProd ? "chessr-review-unlocker" : displayName;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  zip: {
    name: zipName,
    artifactTemplate: "{{name}} v{{version}}.zip",
  },
  manifest: {
    name: displayName,
    description: "Unlock chess.com game reviews — accuracy, move classifications, effective Elo. Powered by Chessr.",
    version: "0.1.0",
    icons: {
      16: "/icons/icon16.png",
      48: "/icons/icon48.png",
      128: "/icons/icon128.png",
    },
    permissions: ["storage", "activeTab"],
    host_permissions: [
      "*://*.chess.com/*",
    ],
    action: {
      default_title: "Chessr - Review Unlocker",
    },
  },
});
