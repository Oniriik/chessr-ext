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
    reanalyze: 'Re-analyze',
  },

  elo: {
    title: 'Target ELO',
    display: 'Chess.com Display',
    antiCheat: 'ELO Randomization ±100',
  },

  modes: {
    title: 'Play Mode',
    default: {
      label: 'Default',
      description: 'Komodo defaults. Pure engine play without personality tweaks.',
    },
    safe: {
      label: 'Safe',
      description: 'Cautious play. Accepts draws, protects king, solid structure.',
    },
    balanced: {
      label: 'Balanced',
      description: 'Human-like neutral play. Neither too cautious nor too risky.',
    },
    positional: {
      label: 'Positional',
      description: 'Strategic play. Solid structure, long-term planning.',
    },
    aggressive: {
      label: 'Aggressive',
      description: 'Attacking play. Avoids draws, sacrifices for initiative.',
    },
    tactical: {
      label: 'Tactical',
      description: 'Seeks complications and combinations. Sharp calculating style.',
    },
    creative: {
      label: 'Creative',
      description: 'Unpredictable play with surprising moves.',
    },
    inhuman: {
      label: 'Inhuman',
      description: 'Pure engine strength. Maximum power, no human patterns.',
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
