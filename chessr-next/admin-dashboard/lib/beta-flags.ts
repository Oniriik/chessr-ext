/**
 * Beta flags list — must stay in sync with serveur/src/betaFlags.ts
 */
export interface BetaFlag {
  code: string
  status: 'hidden' | 'all'
  description: string
}

export const BETA_FLAGS: BetaFlag[] = [
  { code: 'test_feature', status: 'hidden', description: 'Test feature flag for development' },
  { code: 'chesscomUnlock', status: 'hidden', description: 'Unlock Chess.com full analysis on app.chessr.io' },
]
