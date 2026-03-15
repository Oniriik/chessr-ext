/**
 * Background Service Worker
 * Relays messages between content script tabs and the streamer page.
 */

const contentPorts = new Map<number, chrome.runtime.Port>();
let streamerPort: chrome.runtime.Port | null = null;
let lastActiveTabId: number | null = null;

function broadcastToContentPorts(message: unknown) {
  for (const port of contentPorts.values()) {
    try {
      port.postMessage(message);
    } catch {
      // Port disconnected, will be cleaned up by onDisconnect
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'content-script') {
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined) return;

    contentPorts.set(tabId, port);
    lastActiveTabId = tabId;

    // Let the content script know if streamer is already open
    if (streamerPort) {
      port.postMessage({ type: 'streamer_status', isOpen: true });
    }

    port.onMessage.addListener((message) => {
      lastActiveTabId = tabId;
      // Forward to streamer page
      if (streamerPort) {
        try {
          streamerPort.postMessage(message);
        } catch {
          // Streamer port disconnected
        }
      }
    });

    port.onDisconnect.addListener(() => {
      contentPorts.delete(tabId);
      if (lastActiveTabId === tabId) {
        // Pick another tab if available
        const remaining = contentPorts.keys();
        const next = remaining.next();
        lastActiveTabId = next.done ? null : next.value;
      }
    });
  }

  if (port.name === 'streamer') {
    streamerPort = port;
    broadcastToContentPorts({ type: 'streamer_status', isOpen: true });

    port.onMessage.addListener((message) => {
      // Forward selection changes back to the active content tab
      if (lastActiveTabId !== null && contentPorts.has(lastActiveTabId)) {
        try {
          contentPorts.get(lastActiveTabId)!.postMessage(message);
        } catch {
          // Port disconnected
        }
      }
    });

    port.onDisconnect.addListener(() => {
      streamerPort = null;
      broadcastToContentPorts({ type: 'streamer_status', isOpen: false });
    });
  }
});

// Open streamer page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('streamer.html') });
});
