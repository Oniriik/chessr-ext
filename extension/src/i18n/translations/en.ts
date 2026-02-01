import { Translations } from '../types';

export const en: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'My color',
    turn: 'Turn',
    white: 'White',
    black: 'Black',
    lastGamePlayed: 'Last Game Played',
  },

  analysis: {
    eval: 'Eval',
    centipawns: 'Centipawns',
    move: 'Move',
    mateIn: 'Mate in',
    depth: 'Depth',
    reanalyze: 'Re-analyze',
  },

  elo: {
    title: 'Target ELO',
    display: 'Chess.com Display',
    antiCheat: 'ELO Randomization ±100',
    fullStrength: 'Max ELO Power (3500)',
    fullStrengthDesc: 'Unlock maximum engine strength at 3500 ELO',
  },

  personalities: {
    title: 'Personality',
    Default: {
      label: 'Default',
      description: 'Strongest personality with full control over Contempt setting.',
    },
    Aggressive: {
      label: 'Aggressive',
      description: 'Attacks relentlessly, prefers active pieces, biased toward Queen play.',
    },
    Defensive: {
      label: 'Defensive',
      description: 'Emphasizes king safety and solid position above all.',
    },
    Active: {
      label: 'Active',
      description: 'Tends toward open positions and well-placed pieces.',
    },
    Positional: {
      label: 'Positional',
      description: 'Solid play, maneuvering, more closed positions.',
    },
    Endgame: {
      label: 'Endgame',
      description: 'Prefers playing through to win by promoting a pawn.',
    },
    Beginner: {
      label: 'Beginner',
      description: "Doesn't understand fundamentals, looks to check and capture.",
    },
    Human: {
      label: 'Human',
      description: 'Optimized to play like strong human players.',
    },
  },

  engine: {
    title: 'Engine Settings',
    searchMode: 'Search Mode',
    depth: 'Depth',
    timePerMove: 'Time',
    analysisLines: 'Analysis Lines',
  },

  display: {
    title: 'Display',
    showArrows: 'Show Arrows',
    showEvalBar: 'Show Eval Bar',
    blunderThreshold: 'Blunder Threshold',
  },

  suggestions: {
    title: 'Suggestions',
    numberOfSuggestions: 'Number of Suggestions',
    useSameColor: 'Use same color',
    firstSuggestion: '1st Suggestion',
    secondSuggestion: '2nd Suggestion',
    thirdSuggestion: '3rd Suggestion',
    singleColor: 'Suggestion Color',
    showQualityLabels: 'Show move quality labels',
    showQualityLabelsDesc: 'Display Best/Safe/Risky labels on arrows',
    showEffectLabels: 'Show effect labels',
    showEffectLabelsDesc: 'Display mate/check/capture/promotion labels on arrows',
  },

  openings: {
    title: 'Openings',
    nextMove: 'Next move',
    completed: 'Opening completed',
    detected: 'Detected opening',
    waitingForWhite: "Waiting for white's first move...",
    noOpening: 'No opening available',
  },

  settings: {
    title: 'Settings',
    language: 'Language',
    automatic: 'Automatic',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    russian: 'Русский',
    german: 'Deutsch',
    portuguese: 'Português',
    hindi: 'हिन्दी',
    detected: 'detected',
  },

  advanced: {
    title: 'Advanced',
    showAlwaysBestMoveFirst: 'Always show best move first',
    showAlwaysBestMoveFirstDesc: 'The first suggestion is always the best engine move.',
    allowBrilliant: 'Allow brilliant moves',
    allowBrilliantDesc: 'Show moves that sacrifice material for strong positions.',
  },

  feedback: {
    title: 'Move Details',
    showSuggestions: 'Show detailed move suggestions',
    showSuggestionsDesc: 'Display suggestion cards with moves, effects, and quality',
    showRollingAccuracy: 'Show game statistics',
    showRollingAccuracyDesc: 'Display statistics widget with accuracy and move classifications for entire game',
  },

  badges: {
    best: 'Best',
    safe: 'Safe',
    risky: 'Risky',
    human: 'Human',
    alt: 'Alt',
    promotion: 'Promotion',
    mate: 'Mate',
    check: 'Check',
    capture: 'Capture',
    lowRisk: 'Low risk',
    mediumRisk: 'Medium risk',
    highRisk: 'High risk',
  },

  tabs: {
    general: 'General',
    display: 'Display',
    suggestions: 'Suggestions',
    feedback: 'Move Details',
  },

  version: {
    title: 'Update Required',
    message: 'Your version of Chessr is no longer supported. Please update to continue using the extension.',
    current: 'Current',
    required: 'Required',
    download: 'Download Update',
  },

  auth: {
    login: 'Login',
    signup: 'Sign Up',
    forgotPassword: 'Forgot Password',
    loginSubtitle: 'Sign in to access Chessr',
    signupSubtitle: 'Create an account to get started',
    resetSubtitle: 'Enter your email to reset',
    email: 'Email',
    emailPlaceholder: 'email@example.com',
    password: 'Password',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'Confirm Password',
    loginButton: 'Sign In',
    signupButton: 'Sign Up',
    resetButton: 'Send Link',
    forgotPasswordLink: 'Forgot password?',
    noAccount: 'No account?',
    signupLink: 'Sign up',
    hasAccount: 'Already have an account?',
    loginLink: 'Sign in',
    backToLogin: 'Back to login',
    passwordMismatch: 'Passwords do not match',
    passwordTooShort: 'Password must be at least 6 characters',
    accountCreated: 'Account created!',
    verifyYourEmail: 'Verify your email',
    emailSentTo: 'An email has been sent to:',
    resendEmail: 'Resend email',
    emailResent: 'Email sent!',
    resetEmailSent: 'Reset email sent!',
  },
};
