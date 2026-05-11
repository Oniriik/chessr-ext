/**
 * Shared Discord role constants for the admin dashboard.
 * Used by: /api/users, /api/users/resync-discord, /api/linked-accounts
 */

export const PLAN_ROLES: Record<string, string> = {
  free: '1476673977899286548',
  freetrial: '1476674000674623600',
  premium: '1476674055435452698',
  lifetime: '1476674087831998464',
  beta: '1476674108841525340',
}

export const ELO_BRACKETS = [
  { name: 'Beginner', maxElo: 799, roleId: '1476674389540864145' },
  { name: 'Novice', maxElo: 999, roleId: '1476674464920895601' },
  { name: 'Intermediate', maxElo: 1199, roleId: '1476674513440735343' },
  { name: 'Club Player', maxElo: 1399, roleId: '1476674570873471077' },
  { name: 'Advanced', maxElo: 1599, roleId: '1476674628641488976' },
  { name: 'Expert', maxElo: 1799, roleId: '1476674961299996847' },
  { name: 'Master', maxElo: 1999, roleId: '1476674691098869810' },
  { name: 'Grandmaster', maxElo: Infinity, roleId: '1476674811416809566' },
]

export const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  freetrial: 'Free Trial',
  premium: 'Premium',
  lifetime: 'Lifetime',
  beta: 'Beta',
}
