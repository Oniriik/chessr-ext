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
    lastGamePlayed: string;
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
    fullStrength: string;
    fullStrengthDesc: string;
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
    showQualityLabels: string;
    showQualityLabelsDesc: string;
    showEffectLabels: string;
    showEffectLabelsDesc: string;
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
    spanish: string;
    russian: string;
    german: string;
    portuguese: string;
    hindi: string;
    detected: string;
  };

  // Advanced settings
  advanced: {
    title: string;
    showAlwaysBestMoveFirst: string;
    showAlwaysBestMoveFirstDesc: string;
    allowBrilliant: string;
    allowBrilliantDesc: string;
  };

  // Feedback settings
  feedback: {
    title: string;
    showSuggestions: string;
    showSuggestionsDesc: string;
    showRollingAccuracy: string;
    showRollingAccuracyDesc: string;
  };

  // Badges
  badges: {
    best: string;
    safe: string;
    risky: string;
    human: string;
    alt: string;
    promotion: string;
    mate: string;
    check: string;
    capture: string;
    lowRisk: string;
    mediumRisk: string;
    highRisk: string;
  };

  // Tabs
  tabs: {
    general: string;
    display: string;
    suggestions: string;
    feedback: string;
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

export type Language = 'fr' | 'en' | 'es' | 'ru' | 'de' | 'pt' | 'hi';
