/**
 * WorldChess username detection
 * Returns numeric profile ID as username (stable identifier)
 * and display name for UI
 */

/**
 * Get the WorldChess display name from header avatar
 */
export function getWorldChessDisplayName(): string | null {
  const avatarImg = document.querySelector(
    '[data-component="HeaderToolsItemAccountButton"] img[alt^="Your ("]'
  );
  if (avatarImg) {
    const alt = avatarImg.getAttribute('alt') || '';
    const match = alt.match(/^Your \((.+?)\) avatar/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Get the WorldChess numeric profile ID from profile link
 */
export function getWorldChessProfileId(): string | null {
  const profileLink = document.querySelector(
    '[data-component="AccountPopupItem"][data-id="profile"] a'
  ) as HTMLAnchorElement | null;
  if (profileLink?.href) {
    const match = profileLink.href.match(/\/profile\/(\d+)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Get the WorldChess username (display name used as identifier)
 * Falls back to display name if profile ID not available
 */
export function getWorldChessUsername(): string | null {
  return getWorldChessDisplayName();
}
