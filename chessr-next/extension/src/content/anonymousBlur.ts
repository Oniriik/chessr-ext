/**
 * Anonymous Mode - Independent name blur and URL anonymization
 * anonNames: blurs usernames on the chess platform page
 * anonUrl: replaces the URL bar with /a/anon
 */

import { getChessComUsername } from '../lib/chesscom/username';
import { getLichessUsername } from '../lib/lichess/username';
import { detectPlatform } from '../platforms';

const BLUR_CLASS = 'chessr-anon-blur';
const USERNAME_SELECTORS = '.user-username, .user-tagline-username, .cc-user-username-component, .game-overview-player, .battle-player-username, .modal-game-over-user-username';

// Blur state
let domObserver: MutationObserver | null = null;
let currentUsername: string | null = null;
let blurActive = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

// URL anonymization state
let realHref: string = window.location.href;
let urlAnonymized = false;

// ============================================================================
// URL Anonymization (public API used by other modules)
// ============================================================================

/**
 * Get the real URL (before anonymization).
 * Safe to call at any time - returns the true URL even if the address bar shows /a/anon.
 */
export function getRealHref(): string {
  if (!urlAnonymized) return window.location.href;
  const currentPath = window.location.pathname;
  if (currentPath !== '/a/anon') {
    realHref = window.location.href;
  }
  return realHref;
}

/**
 * Capture a navigation that just happened and re-anonymize the URL bar.
 */
export function captureNavigationAndAnonymize() {
  if (!urlAnonymized) return;
  if (window.location.pathname !== '/a/anon') {
    realHref = window.location.href;
    history.replaceState(history.state, '', '/a/anon');
  }
}

function beforeUnloadHandler() {
  if (urlAnonymized) {
    history.replaceState(history.state, '', realHref);
  }
}

function enableUrlAnon() {
  if (urlAnonymized) return;
  realHref = window.location.href;
  urlAnonymized = true;
  history.replaceState(history.state, '', '/a/anon');
  window.addEventListener('beforeunload', beforeUnloadHandler);
}

function disableUrlAnon() {
  if (!urlAnonymized) return;
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  urlAnonymized = false;
  history.replaceState(history.state, '', realHref);
}

// ============================================================================
// Name Blur
// ============================================================================

function detectUsername(): string | null {
  const url = new URL(getRealHref());
  const platform = detectPlatform(url);
  if (!platform) return null;
  if (platform.id === 'chesscom') return getChessComUsername();
  if (platform.id === 'lichess') return getLichessUsername();
  return null;
}

function blurUsernameComponents(root: Element | Document = document) {
  if (root instanceof Element && root.matches(USERNAME_SELECTORS)) {
    if (!root.closest('.chessr-mount, #chessr-root') && !root.classList.contains(BLUR_CLASS)) {
      root.classList.add(BLUR_CLASS);
    }
  }
  root.querySelectorAll(USERNAME_SELECTORS).forEach((el) => {
    if (el.closest('.chessr-mount, #chessr-root')) return;
    if (!el.classList.contains(BLUR_CLASS)) {
      el.classList.add(BLUR_CLASS);
    }
  });
}

function blurMatchingElements(root: Node = document.body) {
  if (root instanceof Element) {
    blurUsernameComponents(root);
  } else {
    blurUsernameComponents(document);
  }

  if (!currentUsername) return;
  const usernameLower = currentUsername.toLowerCase();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.parentElement?.closest('.chessr-mount, #chessr-root')) {
        return NodeFilter.FILTER_REJECT;
      }
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

function unblurAll() {
  document.querySelectorAll(`.${BLUR_CLASS}`).forEach((el) => {
    el.classList.remove(BLUR_CLASS);
  });
}

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

function stopObserver() {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
}

function enableBlur() {
  if (blurActive) return;
  blurActive = true;

  currentUsername = detectUsername();
  blurMatchingElements();
  startObserver();

  if (!currentUsername) {
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

function disableBlur() {
  if (!blurActive) return;
  blurActive = false;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  stopObserver();
  unblurAll();
  currentUsername = null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Re-scan the page (e.g., after SPA navigation)
 */
export function rescanAnonymousBlur() {
  if (urlAnonymized) {
    captureNavigationAndAnonymize();
  }

  if (blurActive) {
    const newUsername = detectUsername();
    if (newUsername !== currentUsername) {
      unblurAll();
      currentUsername = newUsername;
    }
    if (currentUsername) {
      blurMatchingElements();
    }
  }
}

/**
 * Initialize the anonymous system.
 * Reads anonNames and anonUrl from Chrome Storage and listens for changes.
 */
export function initAnonymousBlur() {
  chrome.storage.local.get('chessr-settings', (result) => {
    const settings = result['chessr-settings'];
    const state = settings?.state;
    // Support migrated and new settings
    if (state?.anonNames ?? state?.anonymousMode) enableBlur();
    if (state?.anonUrl ?? state?.anonymousMode) enableUrlAnon();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const settingsChange = changes['chessr-settings'];
    if (!settingsChange) return;

    const newState = settingsChange.newValue?.state;
    const oldState = settingsChange.oldValue?.state;

    const newNames = newState?.anonNames;
    const oldNames = oldState?.anonNames;
    if (newNames !== oldNames) {
      newNames ? enableBlur() : disableBlur();
    }

    const newUrl = newState?.anonUrl;
    const oldUrl = oldState?.anonUrl;
    if (newUrl !== oldUrl) {
      newUrl ? enableUrlAnon() : disableUrlAnon();
    }
  });
}
