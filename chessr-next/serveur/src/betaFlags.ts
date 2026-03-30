/**
 * Beta Flags Configuration
 *
 * - "all": flag is enabled for every user
 * - "hidden": flag is only enabled for users who have it explicitly in their beta_flags column
 */

export interface BetaFlag {
  code: string;
  status: "hidden" | "all";
  description: string;
}

export const BETA_FLAGS: BetaFlag[] = [
  { code: "test_feature", status: "hidden", description: "Test feature flag for development" },
];

/**
 * Resolve the active beta flags for a user.
 * Merges all "all" flags with the user's personal beta_flags from DB.
 */
export function resolveUserBetas(userBetaFlags: string[]): string[] {
  const allFlags = BETA_FLAGS
    .filter((f) => f.status === "all")
    .map((f) => f.code);

  const validHiddenCodes = new Set(
    BETA_FLAGS.filter((f) => f.status === "hidden").map((f) => f.code)
  );

  const userFlags = userBetaFlags.filter((code) => validHiddenCodes.has(code));

  return [...new Set([...allFlags, ...userFlags])];
}
