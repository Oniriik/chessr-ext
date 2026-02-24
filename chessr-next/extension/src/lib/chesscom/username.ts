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

  // Method 2: Aimchess URL in navigation config
  // The URL contains ?username=XXX
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

  // Method 3: Profile dropdown menu
  const profileDropdown = document.querySelector('.home-username-font');
  if (profileDropdown?.textContent) {
    return profileDropdown.textContent.trim();
  }

  // Method 4: Check data attribute on body
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
