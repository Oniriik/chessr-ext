/**
 * chess.com fake-title injection (GM/IM/FM/...). Was previously bundled inside
 * pageContext.content.ts; lives in its own entrypoint so the platform adapter
 * stays focused on game lifecycle.
 *
 * Runs in MAIN world for localStorage parity with chess.com's own JS; toggled
 * via `chessr:setTitle` postMessages from the ISOLATED-world content script.
 */

const TITLE_CLASS = 'chessr-mock-title';
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

export default defineContentScript({
  matches: ['*://chess.com/*', '*://*.chess.com/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    let titleActive = false;
    let titleText = 'GM';
    try {
      titleActive = localStorage.getItem('chessr-title') === 'true';
      titleText = localStorage.getItem('chessr-title-type') || 'GM';
    } catch { /* ignore */ }

    let titleDebounce: ReturnType<typeof setTimeout> | null = null;

    function readUserText(el: Element | null | undefined): string | null {
      if (!el) return null;
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(`.${TITLE_CLASS}`).forEach((n) => n.remove());
      const t = clone.textContent?.trim();
      return t || null;
    }

    function getChessComUsername(): string | null {
      const profileAnchor = document.querySelector('a[data-user-activity-key="profile"]') as HTMLAnchorElement | null;
      if (profileAnchor?.href) {
        const parts = profileAnchor.href.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        if (last) return last;
      }
      const fromSidebar = readUserText(document.querySelector('[data-user-activity-key="profile"] .sidebar-link-text'));
      if (fromSidebar) return fromSidebar;
      const fromNavLink = readUserText(document.querySelector('.nav-link-name'));
      if (fromNavLink) return fromNavLink;
      const fromHeader = readUserText(document.querySelector('.nav-user-header-username'));
      if (fromHeader) return fromHeader;
      if (!document.documentElement.classList.contains('user-logged-in')) return null;
      return null;
    }

    function removeMockTitles() {
      document.querySelectorAll(`.${TITLE_CLASS}`).forEach((el) => el.remove());
    }

    function injectGameTitle(targetLower: string) {
      const containers = document.querySelectorAll('.player-tagline, .cc-user-block-component, .user-block-component');
      containers.forEach((container) => {
        const nameEl = container.querySelector('[data-test-element="user-tagline-username"]');
        if (!nameEl) return;
        if (nameEl.textContent?.trim().toLowerCase() !== targetLower) return;
        if (container.querySelector(`.${TITLE_CLASS}`)) return;
        const title = document.createElement('a');
        title.className = `cc-user-title-component cc-text-x-small-bold ${TITLE_CLASS}`;
        title.href = '/members/titled-players';
        title.target = '_blank';
        title.textContent = titleText;
        nameEl.parentNode?.insertBefore(title, nameEl);
      });
    }

    function injectProfileTitle(targetLower: string) {
      const url = new URL(location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const memberIdx = parts.indexOf('member');
      if (memberIdx === -1) return;
      const profileUsername = parts[memberIdx + 1]?.toLowerCase();
      if (!profileUsername || profileUsername !== targetLower) return;
      const usernameEl = document.querySelector('.profile-card-username');
      if (!usernameEl) return;
      if (usernameEl.parentElement?.querySelector(`.${TITLE_CLASS}`)) return;
      const title = document.createElement('a');
      title.href = '/members/titled-players';
      title.className = `profile-card-chesstitle ${TITLE_CLASS}`;
      title.setAttribute('v-tooltip', TITLE_FULL_NAMES[titleText] || titleText);
      title.textContent = titleText;
      usernameEl.parentElement?.insertBefore(title, usernameEl);
    }

    function injectProfileBadge(targetLower: string) {
      const badgesSection = document.querySelector('.profile-badges');
      if (!badgesSection) return;
      if (badgesSection.querySelector(`.${TITLE_CLASS}`)) return;
      const url = new URL(location.href);
      const parts = url.pathname.split('/').filter(Boolean);
      const memberIdx = parts.indexOf('member');
      if (memberIdx === -1) return;
      const profileUsername = parts[memberIdx + 1]?.toLowerCase();
      if (!profileUsername || profileUsername !== targetLower) return;
      const badge = document.createElement('a');
      badge.className = `profile-badge ${TITLE_CLASS}`;
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
      const streakBadge = badgesSection.querySelector('.profile-badge:has(.streak-badge-about)');
      if (streakBadge) streakBadge.insertAdjacentElement('afterend', badge);
      else badgesSection.insertBefore(badge, badgesSection.firstChild);
    }

    function injectSidebarTitle() {
      const anchor = document.querySelector('a[data-user-activity-key="profile"]');
      if (!anchor) return;
      if (anchor.querySelector(`.${TITLE_CLASS}`)) return;
      const name = anchor.querySelector<HTMLElement>('.sidebar-link-text');
      if (!name) return;
      const title = document.createElement('span');
      title.className = `cc-user-title-component cc-text-x-small-bold ${TITLE_CLASS}`;
      title.textContent = titleText;
      title.style.marginRight = '4px';
      name.insertBefore(title, name.firstChild);
    }

    function injectMockTitle() {
      if (!titleActive) return;
      if (!/(^|\.)chess\.com$/.test(location.hostname)) return;
      const user = getChessComUsername();
      if (!user) return;
      const lower = user.toLowerCase();
      injectGameTitle(lower);
      injectProfileTitle(lower);
      injectProfileBadge(lower);
      injectSidebarTitle();
    }

    function scheduleTitleInject() {
      if (!titleActive) return;
      if (titleDebounce) clearTimeout(titleDebounce);
      titleDebounce = setTimeout(injectMockTitle, 100);
    }

    if (titleActive) scheduleTitleInject();

    const titleObserver = new MutationObserver(() => {
      if (titleActive) scheduleTitleInject();
    });
    titleObserver.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('message', (e) => {
      if (e.data?.type !== 'chessr:setTitle') return;
      const enabled = !!e.data.enabled;
      const type = typeof e.data.type_ === 'string' && e.data.type_ ? e.data.type_ : titleText;
      const typeChanged = type !== titleText;
      titleText = type;
      try {
        localStorage.setItem('chessr-title-type', titleText);
        localStorage.setItem('chessr-title', enabled ? 'true' : 'false');
      } catch { /* ignore */ }
      if (enabled) {
        titleActive = true;
        if (typeChanged) removeMockTitles();
        injectMockTitle();
      } else {
        titleActive = false;
        if (titleDebounce) { clearTimeout(titleDebounce); titleDebounce = null; }
        removeMockTitles();
      }
    });
  },
});
