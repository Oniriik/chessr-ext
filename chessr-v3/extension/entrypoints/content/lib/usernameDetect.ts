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

  return null;
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
