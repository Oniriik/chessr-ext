/**
 * chess.com anonymous-username blur. Was previously bundled inside
 * pageContext.content.ts; lives in its own entrypoint so the platform adapter
 * stays focused on game lifecycle.
 *
 * Runs in MAIN world to share a localStorage namespace with the page; toggled
 * via `chessr:setAnon` postMessages from the ISOLATED-world content script.
 */

const BLUR_CLASS = 'chessr-anon-blur';
const BLUR_STYLE_ID = 'chessr-anon-style';
const USERNAME_SELECTORS = '.user-username, .user-tagline-username, .cc-user-username-component, .user-username-component, .game-overview-player, .battle-player-username, .modal-game-over-user-username, a[data-user-activity-key="profile"] .sidebar-link-text';

export default defineContentScript({
  matches: ['*://chess.com/*', '*://*.chess.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    function injectBlurStyle() {
      if (document.getElementById(BLUR_STYLE_ID)) return;
      const target = document.head || document.documentElement;
      if (!target) return;
      const style = document.createElement('style');
      style.id = BLUR_STYLE_ID;
      style.textContent = `.${BLUR_CLASS} { filter: blur(5px) !important; user-select: none !important; }`;
      target.appendChild(style);
    }

    if (document.head) {
      injectBlurStyle();
    } else {
      document.addEventListener('DOMContentLoaded', injectBlurStyle, { once: true });
    }

    let anonActive = false;
    try { anonActive = localStorage.getItem('chessr-anon') === 'true'; } catch { /* ignore */ }

    function applyBlur() {
      document.querySelectorAll(USERNAME_SELECTORS).forEach((el) => {
        if (!el.classList.contains(BLUR_CLASS)) el.classList.add(BLUR_CLASS);
      });
    }

    function removeBlur() {
      document.querySelectorAll(`.${BLUR_CLASS}`).forEach((el) => el.classList.remove(BLUR_CLASS));
    }

    if (anonActive) applyBlur();

    const blurObserver = new MutationObserver((mutations) => {
      if (!anonActive) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) applyBlur();
        }
      }
    });
    blurObserver.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'chessr:setAnon') {
        anonActive = !!e.data.value;
        try { localStorage.setItem('chessr-anon', anonActive ? 'true' : 'false'); } catch { /* ignore */ }
        if (anonActive) applyBlur();
        else removeBlur();
      }
    });
  },
});
