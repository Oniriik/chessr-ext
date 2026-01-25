import { Translations } from '../types';

export const en: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    title: 'I play',
    white: '⬜ White',
    black: '⬛ Black',
    switch: 'Switch',
    redetect: 'Re-detect',
  },

  analysis: {
    eval: 'Eval',
    centipawns: 'Centipawns',
    move: 'Move',
    mateIn: 'Mate in',
    depth: 'Depth',
  },

  elo: {
    title: 'Target ELO',
    display: 'Chess.com Display',
    antiCheat: 'ELO Randomization ±100',
  },

  modes: {
    title: 'Play Mode',
    safe: {
      label: 'Safe',
      description: 'Solid and positional play. Accepts draws, avoids unnecessary risks.',
    },
    balanced: {
      label: 'Balanced',
      description: 'Neutral play style. Neither too cautious nor too risky.',
    },
    blitz: {
      label: 'Blitz',
      description: 'Quick decisions, slightly aggressive. Optimized for fast games.',
    },
    positional: {
      label: 'Positional',
      description: 'Very solid and patient. Favors lasting positional advantages.',
    },
    aggressive: {
      label: 'Aggressive',
      description: 'Seeks quick checkmate. Avoids draws, takes risks to complicate.',
    },
    tactical: {
      label: 'Tactical',
      description: 'Seeks combinations and sacrifices. Sharp and calculating style.',
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
    detected: 'detected',
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
