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

function getChessComUsername(): string | null {
  // Sidebar profile link
  const profileLink = document.querySelector('[data-user-activity-key="profile"] .sidebar-link-text');
  if (profileLink?.textContent) return profileLink.textContent.trim();

  // Nav link name
  const navLinkName = document.querySelector('.nav-link-name');
  if (navLinkName?.textContent?.trim()) return navLinkName.textContent.trim();

  // Nav user popover
  const navPopover = document.querySelector('[data-test-element="nav-user-popover"]');
  if (navPopover?.textContent?.trim()) return navPopover.textContent.trim();

  // Nav user header
  const navHeader = document.querySelector('.nav-user-header-username');
  if (navHeader?.textContent?.trim()) return navHeader.textContent.trim();

  // Profile link href
  const profileAnchor = document.querySelector('a[data-user-activity-key="profile"]') as HTMLAnchorElement | null;
  if (profileAnchor?.href) {
    const username = profileAnchor.href.split('/').pop();
    if (username) return username;
  }

  // Profile dropdown
  const profileDropdown = document.querySelector('.home-username-font');
  if (profileDropdown?.textContent) return profileDropdown.textContent.trim();

  // Body data attribute
  if (document.body.dataset.username) return document.body.dataset.username;

  return null;
}

function getLichessUsername(): string | null {
  const userTag = document.querySelector('#top #user_tag');
  if (userTag?.textContent) return userTag.textContent.trim();
  return null;
}
