export default defineBackground(() => {
  console.log('Chessr v3 background loaded');

  // Proxy for fetching extension files from content scripts.
  // Content scripts can't fetch chrome-extension:// URLs directly.
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'fetchExtensionFile' && msg.path) {
      fetch(browser.runtime.getURL(msg.path))
        .then((r) => r.text())
        .then((text) => sendResponse({ text }))
        .catch((err) => sendResponse({ error: err.message }));
      return true; // keep channel open for async response
    }
  });
});
