/**
 * Title Simulator - Injects a mock chess title badge next to the user's name on chess.com
 * Follows the same pattern as anonymousBlur.ts
 */

import { getChessComUsername } from '../lib/chesscom/username';
import { detectPlatform } from '../platforms';
import { getRealHref } from './anonymousBlur';

const MOCK_TITLE_CLASS = 'chessr-mock-title';

const TITLE_FULL_NAMES: Record<string, string> = {
  GM: 'Grandmaster',
  IM: 'International Master',
  FM: 'FIDE Master',
  NM: 'National Master',
  CM: 'FIDE Candidate Master',
  WGM: 'Woman Grandmaster',
  WIM: 'Woman International Master',
  WFM: 'Woman FIDE Master',
  WCM: 'FIDE Woman Candidate Master',
  WNM: 'Woman National Master',
};

let titleEnabled = false;
let titleText = 'GM';
let domObserver: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function removeMockTitles() {
  document.querySelectorAll(`.${MOCK_TITLE_CLASS}`).forEach((el) => el.remove());
}

function injectGameTitle(targetLower: string) {
  const containers = document.querySelectorAll(
    '.player-tagline, .cc-user-block-component, .user-block-component'
  );

  containers.forEach((container) => {
    const nameEl = container.querySelector(
      '[data-test-element="user-tagline-username"]'
    );
    if (!nameEl) return;
    if (nameEl.textContent?.trim().toLowerCase() !== targetLower) return;
    if (container.querySelector(`.${MOCK_TITLE_CLASS}`)) return;

    const title = document.createElement('a');
    title.className = `cc-user-title-component cc-text-x-small-bold ${MOCK_TITLE_CLASS}`;
    title.href = '/members/titled-players';
    title.target = '_blank';
    title.textContent = titleText;

    nameEl.parentNode?.insertBefore(title, nameEl);
  });
}

function injectProfileBadge(targetLower: string) {
  const badgesSection = document.querySelector('.profile-badges');
  if (!badgesSection) return;
  if (badgesSection.querySelector(`.${MOCK_TITLE_CLASS}`)) return;

  // Only inject on the logged-in user's own profile page
  const url = new URL(getRealHref());
  const pathParts = url.pathname.split('/').filter(Boolean);
  // Profile URLs: /member/username or /xx/member/username (with locale prefix)
  const memberIdx = pathParts.indexOf('member');
  if (memberIdx === -1) return;
  const profileUsername = pathParts[memberIdx + 1]?.toLowerCase();
  if (!profileUsername || profileUsername !== targetLower) return;

  const badge = document.createElement('a');
  badge.className = `profile-badge ${MOCK_TITLE_CLASS}`;
  badge.href = '/members/titled-players';
  badge.target = '_blank';

  const icon = document.createElement('div');
  icon.className = 'badges-icon-square badges-titled';
  icon.innerHTML = '<span class="cc-icon-glyph cc-icon-size-24 badges-icon"><svg aria-hidden="true" data-glyph="game-crown-2" viewBox="0 0 24 24" height="24" width="24" xmlns="http://www.w3.org/2000/svg" style="fill:currentColor"><path d="M19 20V22H5.00002V20H19ZM1.27002 6.57001C2.30002 5.54001 3.47002 5.54001 4.17002 6.24001C4.74002 6.81001 4.84002 7.64001 4.17002 8.64001L7.24002 10.91C7.31002 10.98 7.47002 10.94 7.54002 10.84L10.37 6.84001H9.87002C8.77002 6.84001 8.30002 6.07001 8.30002 5.34001C8.30002 4.54001 9.00002 3.84001 9.87002 3.84001H10.5V3.11001C10.5 2.21001 11.2 1.51001 12 1.51001C12.83 1.51001 13.5 2.21001 13.5 3.11001V3.84001H14.13C15 3.84001 15.7 4.54001 15.7 5.34001C15.7 6.07001 15.23 6.84001 14.13 6.84001H13.63L16.5 10.84C16.57 10.94 16.67 10.97 16.77 10.91L19.8 8.68001C19.13 7.68001 19.23 6.81001 19.83 6.25001C20.53 5.52001 21.7 5.55001 22.73 6.58001L19 18.01H5.00002L1.27002 6.57001Z"></path></svg></span>';

  const about = document.createElement('div');
  about.className = 'badges-about';
  about.innerHTML = `<span class="cc-heading-xx-small badges-name">Titled Player</span> <span class="cc-text-small badges-extra">${TITLE_FULL_NAMES[titleText] || titleText}</span>`;

  badge.appendChild(icon);
  badge.appendChild(about);

  // Insert after streak badge if present, otherwise as first badge
  const streakBadge = badgesSection.querySelector('.profile-badge:has(.streak-badge-about)');
  if (streakBadge) {
    streakBadge.insertAdjacentElement('afterend', badge);
  } else {
    badgesSection.insertBefore(badge, badgesSection.firstChild);
  }
}

function injectProfileTitle(targetLower: string) {
  // Only on the user's own profile page
  const url = new URL(getRealHref());
  const pathParts = url.pathname.split('/').filter(Boolean);
  const memberIdx = pathParts.indexOf('member');
  if (memberIdx === -1) return;
  const profileUsername = pathParts[memberIdx + 1]?.toLowerCase();
  if (!profileUsername || profileUsername !== targetLower) return;

  // Find the profile card username element
  const usernameEl = document.querySelector('.profile-card-username');
  if (!usernameEl) return;
  if (usernameEl.parentElement?.querySelector(`.${MOCK_TITLE_CLASS}`)) return;

  const title = document.createElement('a');
  title.href = '/members/titled-players';
  title.className = `profile-card-chesstitle ${MOCK_TITLE_CLASS}`;
  title.setAttribute('v-tooltip', TITLE_FULL_NAMES[titleText] || titleText);
  title.textContent = titleText;

  usernameEl.parentElement?.insertBefore(title, usernameEl);
}

function injectMockTitle() {
  if (!titleEnabled) return;

  const url = new URL(getRealHref());
  const platform = detectPlatform(url);
  if (!platform || platform.id !== 'chesscom') return;

  const targetUser = getChessComUsername();
  if (!targetUser) return;

  const targetLower = targetUser.toLowerCase();

  injectGameTitle(targetLower);
  injectProfileTitle(targetLower);
  injectProfileBadge(targetLower);
}

function startObserver() {
  if (domObserver) return;

  domObserver = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectMockTitle, 100);
  });

  domObserver.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
  if (domObserver) {
    domObserver.disconnect();
    domObserver = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function enable() {
  if (titleEnabled) return;
  titleEnabled = true;
  injectMockTitle();
  startObserver();
}

function disable() {
  if (!titleEnabled) return;
  titleEnabled = false;
  stopObserver();
  removeMockTitles();
}

/**
 * Re-scan the page (e.g., after SPA navigation)
 */
export function rescanTitleSimulator() {
  if (titleEnabled) {
    removeMockTitles();
    injectMockTitle();
  }
}

/**
 * Initialize the title simulator.
 * Reads showTitle and titleType from Chrome Storage and listens for changes.
 */
export function initTitleSimulator() {
  chrome.storage.local.get('chessr-settings', (result) => {
    const state = result['chessr-settings']?.state;
    if (state?.showTitle) {
      titleText = state.titleType || 'GM';
      enable();
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    const settingsChange = changes['chessr-settings'];
    if (!settingsChange) return;

    const newState = settingsChange.newValue?.state;
    const oldState = settingsChange.oldValue?.state;

    const newShow = newState?.showTitle;
    const oldShow = oldState?.showTitle;
    const newType = newState?.titleType;
    const oldType = oldState?.titleType;

    // Title type changed
    if (newType !== oldType && newType) {
      titleText = newType;
      if (titleEnabled) {
        removeMockTitles();
        injectMockTitle();
      }
    }

    // Toggle changed
    if (newShow !== oldShow) {
      newShow ? enable() : disable();
    }
  });
}
