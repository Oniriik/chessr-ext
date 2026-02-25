/**
 * Lichess username detection
 * Extracts the logged-in user's username from the DOM
 */

/**
 * Get the Lichess username of the currently logged-in user
 * @returns The username or null if not logged in
 */
export function getLichessUsername(): string | null {
  // Get username from user_tag button in top header
  const userTag = document.querySelector('#top #user_tag');
  if (userTag?.textContent) {
    return userTag.textContent.trim();
  }

  return null;
}

/**
 * Check if the user is logged in to Lichess
 */
export function isLichessLoggedIn(): boolean {
  // Check for user_tag in top header
  const userTag = document.querySelector('#top #user_tag');
  return !!userTag?.textContent;
}
