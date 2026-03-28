/**
 * Chess.com username detection
 * Extracts the logged-in user's username from the DOM or window object
 */

interface ChessComNavConfig {
  favorited?: NavItem[];
  other?: NavItem[];
}

interface NavItem {
  id: string;
  url?: string;
  sub?: NavItem[];
}

/**
 * Get the Chess.com username of the currently logged-in user
 * @returns The username or null if not logged in
 */
export function getChessComUsername(): string | null {
  // Method 1: Sidebar profile link (most reliable when visible)
  const profileLink = document.querySelector(
    '[data-user-activity-key="profile"] .sidebar-link-text'
  );
  if (profileLink?.textContent) {
    return profileLink.textContent.trim();
  }

  // Method 2: Nav link name
  const navLinkName = document.querySelector('.nav-link-name');
  if (navLinkName?.textContent?.trim()) {
    return navLinkName.textContent.trim();
  }

  // Method 3: Nav user popover
  const navPopover = document.querySelector('[data-test-element="nav-user-popover"]');
  if (navPopover?.textContent?.trim()) {
    return navPopover.textContent.trim();
  }

  // Method 4: Nav user header username
  const navHeader = document.querySelector('.nav-user-header-username');
  if (navHeader?.textContent?.trim()) {
    return navHeader.textContent.trim();
  }

  // Method 5: Extract from profile link href
  const profileAnchor = document.querySelector('a[data-user-activity-key="profile"]') as HTMLAnchorElement | null;
  if (profileAnchor?.href) {
    const username = profileAnchor.href.split('/').pop();
    if (username) return username;
  }

  // Method 6: Aimchess URL in navigation config
  const navConfig = (window as any).chesscom?.userNavigationConfig as ChessComNavConfig | undefined;
  if (navConfig) {
    const other = navConfig.other || [];
    const train = other.find((item) => item.id === 'train');
    if (train?.sub) {
      const aimchess = train.sub.find((item) => item.id === 'train.aimchess');
      if (aimchess?.url) {
        const match = aimchess.url.match(/username=([^&]+)/);
        if (match) return match[1];
      }
    }
  }

  // Method 7: Profile dropdown menu
  const profileDropdown = document.querySelector('.home-username-font');
  if (profileDropdown?.textContent) {
    return profileDropdown.textContent.trim();
  }

  // Method 8: Check data attribute on body
  const bodyUsername = document.body.dataset.username;
  if (bodyUsername) {
    return bodyUsername;
  }

  // Check if user is logged in at all
  if (!document.documentElement.classList.contains('user-logged-in')) {
    return null;
  }

  return null;
}

/**
 * Check if the user is logged in to Chess.com
 */
export function isChessComLoggedIn(): boolean {
  return document.documentElement.classList.contains('user-logged-in');
}
