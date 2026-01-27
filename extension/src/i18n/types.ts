export interface Translations {
  // App
  app: {
    name: string;
  };

  // Player color
  player: {
    myColor: string;
    turn: string;
    white: string;
    black: string;
  };

  // Analysis
  analysis: {
    eval: string;
    centipawns: string;
    move: string;
    mateIn: string;
    depth: string;
    reanalyze: string;
  };

  // ELO
  elo: {
    title: string;
    display: string;
    antiCheat: string;
  };

  // Komodo Personalities
  personalities: {
    title: string;
    Default: {
      label: string;
      description: string;
    };
    Aggressive: {
      label: string;
      description: string;
    };
    Defensive: {
      label: string;
      description: string;
    };
    Active: {
      label: string;
      description: string;
    };
    Positional: {
      label: string;
      description: string;
    };
    Endgame: {
      label: string;
      description: string;
    };
    Beginner: {
      label: string;
      description: string;
    };
    Human: {
      label: string;
      description: string;
    };
  };

  // Engine settings
  engine: {
    title: string;
    searchMode: string;
    depth: string;
    timePerMove: string;
    analysisLines: string;
  };

  // Display settings
  display: {
    title: string;
    showArrows: string;
    showEvalBar: string;
    blunderThreshold: string;
  };

  // Suggestions settings
  suggestions: {
    title: string;
    numberOfSuggestions: string;
    useSameColor: string;
    firstSuggestion: string;
    secondSuggestion: string;
    thirdSuggestion: string;
    singleColor: string;
  };

  // Openings
  openings: {
    title: string;
    nextMove: string;
    completed: string;
    detected: string;
    waitingForWhite: string;
    noOpening: string;
  };

  // Settings modal
  settings: {
    title: string;
    language: string;
    automatic: string;
    french: string;
    english: string;
    detected: string;
  };

  // Version check
  version: {
    title: string;
    message: string;
    current: string;
    required: string;
    download: string;
  };

  // Auth
  auth: {
    login: string;
    signup: string;
    forgotPassword: string;
    loginSubtitle: string;
    signupSubtitle: string;
    resetSubtitle: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    confirmPassword: string;
    loginButton: string;
    signupButton: string;
    resetButton: string;
    forgotPasswordLink: string;
    noAccount: string;
    signupLink: string;
    hasAccount: string;
    loginLink: string;
    backToLogin: string;
    passwordMismatch: string;
    passwordTooShort: string;
    accountCreated: string;
    verifyYourEmail: string;
    emailSentTo: string;
    resendEmail: string;
    emailResent: string;
    resetEmailSent: string;
  };
}

export type Language = 'fr' | 'en';
