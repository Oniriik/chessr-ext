import type { Platform } from './platformApi';

export function detectCurrentUsername(): { platform: Platform; username: string } | null {
  const host = window.location.hostname;

  if (host.includes('chess.com')) {
    const username = getChessComUsername();
    if (username) return { platform: 'chesscom', username };
  }

  if (host.includes('lichess.org')) {
    const username = getLichessUsername();
    if (username) return { platform: 'lichess', username };
  }

  if (host.includes('worldchess.com')) {
    const username = getWorldchessUsername();
    if (username) return { platform: 'worldchess', username };
  }

  return null;
}

/** Read the worldchess.com profile id of the currently-logged-in user.
 *  Worldchess shows a "My profile" link in the user dropdown that points
 *  at `/profile/<numericId>`. We use the numeric id (not the display
 *  name) as the linking identifier — display names aren't unique on
 *  worldchess and can be edited freely. */
export function getWorldchessUserId(): string | null {
  // The "My profile" entry in the nav dropdown — match by text since
  // there's no stable data-* attr. English is the canonical UI label;
  // a few other locales worldchess ships are listed too. Falls back to
  // the avatar-link in the page header (any /profile/ link outside the
  // game cards is the logged-in user). */
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="/profile/"]'));
  const byText = links.find((a) => /my profile|mon profil|mein profil|mi perfil|il mio profilo/i.test(a.textContent ?? ''));
  const href = byText?.getAttribute('href');
  if (!href) return null;
  const m = href.match(/^\/profile\/(\d+)/);
  return m ? m[1] : null;
}

function getWorldchessUsername(): string | null {
  // Return the numeric profile id, NOT the display name. The link-account
  // path passes this string to fetchPlatformProfile which calls
  // api.worldchess.com — that endpoint only accepts the numeric id, and
  // returns the canonical full_name + avatar + ratings. Display names
  // can be edited by the user and aren't unique, so the id is the right
  // long-term identifier to store anyway.
  return getWorldchessUserId();
}

/**
 * Read an element's textContent while ignoring Chessr's own mock-title badge
 * (`.chessr-mock-title`), which pageContext may inject INSIDE the username
 * element. Without stripping, a "GM" badge would produce "GMfoobar" instead of
 * "foobar" and break chess.com API lookups.
 */
function readUsernameText(el: Element | null | undefined): string | null {
  if (!el) return null;
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.chessr-mock-title').forEach((n) => n.remove());
  const text = clone.textContent?.trim();
  return text || null;
}

function getChessComUsername(): string | null {
  // Profile link href — most reliable (immune to DOM badge injection).
  const profileAnchor = document.querySelector('a[data-user-activity-key="profile"]') as HTMLAnchorElement | null;
  if (profileAnchor?.href) {
    const username = profileAnchor.href.split('/').pop();
    if (username) return username;
  }

  // Sidebar profile link text (stripped of any injected title badge)
  const sidebarLink = document.querySelector('[data-user-activity-key="profile"] .sidebar-link-text');
  const fromSidebar = readUsernameText(sidebarLink);
  if (fromSidebar) return fromSidebar;

  // Nav link name
  const fromNavLink = readUsernameText(document.querySelector('.nav-link-name'));
  if (fromNavLink) return fromNavLink;

  // Nav user popover
  const fromPopover = readUsernameText(document.querySelector('[data-test-element="nav-user-popover"]'));
  if (fromPopover) return fromPopover;

  // Nav user header
  const fromHeader = readUsernameText(document.querySelector('.nav-user-header-username'));
  if (fromHeader) return fromHeader;

  // Profile dropdown
  const fromDropdown = readUsernameText(document.querySelector('.home-username-font'));
  if (fromDropdown) return fromDropdown;

  // Body data attribute
  if (document.body.dataset.username) return document.body.dataset.username;

  return null;
}

function getLichessUsername(): string | null {
  const userTag = document.querySelector('#top #user_tag');
  if (userTag?.textContent) return userTag.textContent.trim();
  return null;
}
