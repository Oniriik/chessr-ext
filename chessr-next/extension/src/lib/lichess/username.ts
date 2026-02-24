/**
 * Lichess username detection
 * Extracts the logged-in user's username from the DOM or window object
 */

interface LichessMe {
  username?: string;
}

interface LichessGlobal {
  me?: LichessMe;
}

/**
 * Get the Lichess username of the currently logged-in user
 * @returns The username or null if not logged in
 */
export function getLichessUsername(): string | null {
  // Method 1: User link in header (most reliable)
  const userLink = document.querySelector('a.user-link');
  if (userLink) {
    const href = userLink.getAttribute('href');
    if (href?.startsWith('/@/')) {
      return href.slice(3);
    }
  }

  // Method 2: Lichess global object
  const lichess = (window as any).lichess as LichessGlobal | undefined;
  if (lichess?.me?.username) {
    return lichess.me.username;
  }

  // Method 3: User dropdown in header
  const userDropdown = document.querySelector('#user_tag');
  if (userDropdown?.textContent) {
    return userDropdown.textContent.trim();
  }

  // Method 4: Data attribute on body
  const bodyData = document.body.dataset;
  if (bodyData.user) {
    return bodyData.user;
  }

  return null;
}

/**
 * Check if the user is logged in to Lichess
 */
export function isLichessLoggedIn(): boolean {
  // Check for user link
  const userLink = document.querySelector('a.user-link');
  if (userLink) return true;

  // Check for lichess.me
  const lichess = (window as any).lichess as LichessGlobal | undefined;
  if (lichess?.me?.username) return true;

  // Check for dasher (user menu)
  const dasher = document.querySelector('.dasher');
  if (dasher) return true;

  return false;
}
