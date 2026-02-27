/**
 * Anonymous Blur - Blurs the player's username on the chess platform page
 * When anonymous mode is enabled, finds all DOM elements containing
 * the logged-in username and applies a blur filter.
 * Uses MutationObserver to handle dynamically added elements.
 */

import { getChessComUsername } from '../lib/chesscom/username';
import { getLichessUsername } from '../lib/lichess/username';
import { detectPlatform } from '../platforms';

const BLUR_CLASS = 'chessr-anon-blur';
const USERNAME_SELECTORS = '.user-username, .user-tagline-username, .cc-user-username-component, .game-overview-player';

let domObserver: MutationObserver | null = null;
let currentUsername: string | null = null;
let isActive = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Detect the current platform username
 */
function detectUsername(): string | null {
  const url = new URL(window.location.href);
  const platform = detectPlatform(url);
  if (!platform) return null;

  if (platform.id === 'chesscom') return getChessComUsername();
  if (platform.id === 'lichess') return getLichessUsername();
  return null;
}

/**
 * Blur all elements with the .user-username-component class (Chess.com username elements)
 */
function blurUsernameComponents(root: Element | Document = document) {
  // Check if the root element itself matches
  if (root instanceof Element && root.matches(USERNAME_SELECTORS)) {
    if (!root.closest('.chessr-mount, #chessr-root') && !root.classList.contains(BLUR_CLASS)) {
      root.classList.add(BLUR_CLASS);
    }
  }
  // Check descendants
  root.querySelectorAll(USERNAME_SELECTORS).forEach((el) => {
    if (el.closest('.chessr-mount, #chessr-root')) return;
    if (!el.classList.contains(BLUR_CLASS)) {
      el.classList.add(BLUR_CLASS);
    }
  });
}

/**
 * Find and blur all elements containing the username within a root node
 */
function blurMatchingElements(root: Node = document.body) {
  // Blur .user-username-component elements
  if (root instanceof Element) {
    blurUsernameComponents(root);
  } else {
    blurUsernameComponents(document);
  }

  if (!currentUsername) return;

  const usernameLower = currentUsername.toLowerCase();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip our own extension elements
      if (node.parentElement?.closest('.chessr-mount, #chessr-root')) {
        return NodeFilter.FILTER_REJECT;
      }
      // Skip already blurred parents
      if (node.parentElement?.classList.contains(BLUR_CLASS)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (node.textContent?.toLowerCase().includes(usernameLower)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_REJECT;
    },
  });

  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent) {
      parent.classList.add(BLUR_CLASS);
    }
  }
}

/**
 * Remove blur from all blurred elements
 */
function unblurAll() {
  document.querySelectorAll(`.${BLUR_CLASS}`).forEach((el) => {
    el.classList.remove(BLUR_CLASS);
  });
}

/**
 * Start observing DOM for new elements containing the username
 */
function startObserver() {
  if (domObserver) return;

  domObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            if (node.closest('.chessr-mount, #chessr-root')) continue;
            blurMatchingElements(node);
          }
        }
      } else if (mutation.type === 'attributes') {
        // Handle class changes (e.g., Chess.com adds class after element insertion)
        const target = mutation.target;
        if (target instanceof HTMLElement && !target.closest('.chessr-mount, #chessr-root')) {
          if (target.matches(USERNAME_SELECTORS) && !target.classList.contains(BLUR_CLASS)) {
            target.classList.add(BLUR_CLASS);
          }
        }
      }
    }
  });

  domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

/**
 * Stop the DOM observer
 */
function stopObserver() {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
}

/**
 * Enable anonymous blur on the platform page
 */
function enable() {
  if (isActive) return;
  isActive = true;

  currentUsername = detectUsername();

  // Always blur .user-username-component elements and start observer
  blurMatchingElements();
  startObserver();

  if (!currentUsername) {
    // Username not available yet (page still loading), retry a few times
    let retries = 0;
    const tryDetect = () => {
      currentUsername = detectUsername();
      if (currentUsername) {
        blurMatchingElements();
      } else if (retries < 10) {
        retries++;
        retryTimer = setTimeout(tryDetect, 500);
      }
    };
    retryTimer = setTimeout(tryDetect, 500);
  }
}

/**
 * Disable anonymous blur
 */
function disable() {
  if (!isActive) return;
  isActive = false;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  stopObserver();
  unblurAll();
  currentUsername = null;
}

/**
 * Re-scan the page (e.g., after SPA navigation)
 */
export function rescanAnonymousBlur() {
  if (!isActive) return;

  // Re-detect username (might be on a different page now)
  const newUsername = detectUsername();
  if (newUsername !== currentUsername) {
    unblurAll();
    currentUsername = newUsername;
  }

  if (currentUsername) {
    blurMatchingElements();
  }
}

/**
 * Initialize the anonymous blur system.
 * Reads setting from Chrome Storage and listens for changes.
 */
export function initAnonymousBlur() {
  // Read initial value
  chrome.storage.local.get('chessr-settings', (result) => {
    const settings = result['chessr-settings'];
    if (settings?.state?.anonymousMode) {
      enable();
    }
  });

  // Listen for setting changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const settingsChange = changes['chessr-settings'];
    if (!settingsChange) return;

    const newAnon = settingsChange.newValue?.state?.anonymousMode;
    const oldAnon = settingsChange.oldValue?.state?.anonymousMode;

    if (newAnon !== oldAnon) {
      if (newAnon) {
        enable();
      } else {
        disable();
      }
    }
  });
}
