/**
 * Background Service Worker
 * Relays messages between content script tabs and the streamer page.
 */

const contentPorts = new Map<number, chrome.runtime.Port>();
let streamerPort: chrome.runtime.Port | null = null;
let reviewPort: chrome.runtime.Port | null = null;
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
      // Forward review results to review page
      if (reviewPort && (
        message.type === 'chesscom_review_progress' ||
        message.type === 'chesscom_review_result' ||
        message.type === 'chesscom_review_error'
      )) {
        try {
          reviewPort.postMessage(message);
        } catch {
          // Review port disconnected
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

  if (port.name === 'review') {
    reviewPort = port;

    port.onMessage.addListener((message) => {
      // Forward review requests to the active content script tab
      if (message.type === 'request_review') {
        if (lastActiveTabId !== null && contentPorts.has(lastActiveTabId)) {
          try {
            contentPorts.get(lastActiveTabId)!.postMessage({
              type: 'request_review',
              gameId: message.gameId,
              gameType: message.gameType || 'live',
            });
          } catch {
            reviewPort?.postMessage({ type: 'chesscom_review_error', error: 'No active chess tab found' });
          }
        } else {
          reviewPort?.postMessage({ type: 'chesscom_review_error', error: 'No active chess tab found. Keep a chess.com tab open.' });
        }
      }
    });

    port.onDisconnect.addListener(() => {
      reviewPort = null;
    });
  }
});

// Open streamer page when extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('streamer.html') });
});

// Handle messages from content scripts and billing page
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'open_billing') {
    chrome.tabs.create({ url: chrome.runtime.getURL('billing.html') });
  }
  if (message.type === 'plan_updated') {
    // Relay to all content script tabs so they refresh the plan
    broadcastToContentPorts(message);
  }
  if (message.type === 'open_review') {
    const params = new URLSearchParams({ gameId: message.gameId, gameType: message.gameType || 'live' });
    chrome.tabs.create({ url: chrome.runtime.getURL('review.html') + '?' + params.toString() });
  }
  if (message.type === 'get_chesscom_cookies') {
    chrome.cookies.getAll({ domain: '.chess.com' }, (cookies) => {
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      sendResponse({ cookies: cookieStr });
    });
    return true; // keep channel open for async response
  }
});
