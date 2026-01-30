import { Translations } from '../types';

export const de: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'Meine Farbe',
    turn: 'Zug',
    white: 'Weiß',
    black: 'Schwarz',
    lastGamePlayed: 'Letzte Gespielte Partie',
  },

  analysis: {
    eval: 'Bewertung',
    centipawns: 'Hundertstel',
    move: 'Zug',
    mateIn: 'Matt in',
    depth: 'Tiefe',
    reanalyze: 'Neu analysieren',
  },

  elo: {
    title: 'Ziel-ELO',
    display: 'Chess.com Anzeige',
    antiCheat: 'ELO Randomisierung ±100',
    fullStrength: 'Volle-Stärke-Modus',
    fullStrengthDesc: 'ELO-Limit deaktivieren für Vorschläge mit maximaler Stärke (verfügbar ab 2000 ELO)',
  },

  personalities: {
    title: 'Persönlichkeit',
    Default: {
      label: 'Standard',
      description: 'Stärkste Persönlichkeit mit voller Kontrolle über die Contempt-Einstellung.',
    },
    Aggressive: {
      label: 'Aggressiv',
      description: 'Greift gnadenlos an, bevorzugt aktive Figuren, tendiert zum Damenspiel.',
    },
    Defensive: {
      label: 'Defensiv',
      description: 'Betont Königssicherheit und solide Position über alles.',
    },
    Active: {
      label: 'Aktiv',
      description: 'Tendiert zu offenen Stellungen und gut platzierten Figuren.',
    },
    Positional: {
      label: 'Positionell',
      description: 'Solides Spiel, Manövrieren, mehr geschlossene Stellungen.',
    },
    Endgame: {
      label: 'Endspiel',
      description: 'Bevorzugt das Durchspielen zum Gewinn durch Bauernumwandlung.',
    },
    Beginner: {
      label: 'Anfänger',
      description: 'Versteht Grundlagen nicht, sucht nach Schach und Schlagen.',
    },
    Human: {
      label: 'Menschlich',
      description: 'Optimiert, um wie starke menschliche Spieler zu spielen.',
    },
  },

  engine: {
    title: 'Engine-Einstellungen',
    searchMode: 'Suchmodus',
    depth: 'Tiefe',
    timePerMove: 'Zeit',
    analysisLines: 'Analyselinien',
  },

  display: {
    title: 'Anzeige',
    showArrows: 'Pfeile Anzeigen',
    showEvalBar: 'Bewertungsleiste Anzeigen',
    blunderThreshold: 'Fehler-Schwellenwert',
  },

  suggestions: {
    title: 'Vorschläge',
    numberOfSuggestions: 'Anzahl der Vorschläge',
    useSameColor: 'Gleiche Farbe verwenden',
    firstSuggestion: '1. Vorschlag',
    secondSuggestion: '2. Vorschlag',
    thirdSuggestion: '3. Vorschlag',
    singleColor: 'Vorschlagsfarbe',
    showQualityLabels: 'Qualitätslabels anzeigen',
    showQualityLabelsDesc: 'Beste/Sicher/Riskant Labels auf Pfeilen anzeigen',
    showEffectLabels: 'Effekt-Labels anzeigen',
    showEffectLabelsDesc: 'Matt/Schach/Schlagen/Umwandlung Labels auf Pfeilen anzeigen',
  },

  openings: {
    title: 'Eröffnungen',
    nextMove: 'Nächster Zug',
    completed: 'Eröffnung abgeschlossen',
    detected: 'Eröffnung erkannt',
    waitingForWhite: 'Warte auf ersten Zug von Weiß...',
    noOpening: 'Keine Eröffnung verfügbar',
  },

  settings: {
    title: 'Einstellungen',
    language: 'Sprache',
    automatic: 'Automatisch',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    russian: 'Русский',
    german: 'Deutsch',
    portuguese: 'Português',
    hindi: 'हिन्दी',
    detected: 'erkannt',
  },

  advanced: {
    title: 'Erweitert',
    showAlwaysBestMoveFirst: 'Immer besten Zug zuerst zeigen',
    showAlwaysBestMoveFirstDesc: 'Der erste Vorschlag ist immer der beste Engine-Zug.',
    allowBrilliant: 'Brillante Züge erlauben',
    allowBrilliantDesc: 'Zeige Züge, die Material für starke Stellungen opfern.',
  },

  feedback: {
    title: 'Zug-Details',
    showSuggestions: 'Detaillierte Vorschläge anzeigen',
    showSuggestionsDesc: 'Zeige Vorschlagskarten mit Zügen, Effekten und Qualität',
    showRollingAccuracy: 'Laufende Genauigkeit anzeigen',
    showRollingAccuracyDesc: 'Zeige Genauigkeits-Widget für die letzten 10 Züge',
  },

  badges: {
    best: 'Beste',
    safe: 'Sicher',
    risky: 'Riskant',
    human: 'Menschlich',
    alt: 'Alt',
    promotion: 'Umwandlung',
    mate: 'Matt',
    check: 'Schach',
    capture: 'Schlagen',
    lowRisk: 'Niedriges Risiko',
    mediumRisk: 'Mittleres Risiko',
    highRisk: 'Hohes Risiko',
  },

  tabs: {
    general: 'Allgemein',
    display: 'Anzeige',
    suggestions: 'Vorschläge',
    feedback: 'Details',
  },

  version: {
    title: 'Update Erforderlich',
    message: 'Ihre Version von Chessr wird nicht mehr unterstützt. Bitte aktualisieren Sie, um die Erweiterung weiter zu verwenden.',
    current: 'Aktuell',
    required: 'Erforderlich',
    download: 'Update Herunterladen',
  },

  auth: {
    login: 'Anmelden',
    signup: 'Registrieren',
    forgotPassword: 'Passwort Vergessen',
    loginSubtitle: 'Melden Sie sich an, um auf Chessr zuzugreifen',
    signupSubtitle: 'Erstellen Sie ein Konto, um zu beginnen',
    resetSubtitle: 'Geben Sie Ihre E-Mail zum Zurücksetzen ein',
    email: 'E-Mail',
    emailPlaceholder: 'email@beispiel.com',
    password: 'Passwort',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'Passwort Bestätigen',
    loginButton: 'Anmelden',
    signupButton: 'Registrieren',
    resetButton: 'Link Senden',
    forgotPasswordLink: 'Passwort vergessen?',
    noAccount: 'Kein Konto?',
    signupLink: 'Registrieren',
    hasAccount: 'Haben Sie bereits ein Konto?',
    loginLink: 'Anmelden',
    backToLogin: 'Zurück zur Anmeldung',
    passwordMismatch: 'Passwörter stimmen nicht überein',
    passwordTooShort: 'Passwort muss mindestens 6 Zeichen haben',
    accountCreated: 'Konto erstellt!',
    verifyYourEmail: 'Bestätigen Sie Ihre E-Mail',
    emailSentTo: 'Eine E-Mail wurde gesendet an:',
    resendEmail: 'E-Mail erneut senden',
    emailResent: 'E-Mail gesendet!',
    resetEmailSent: 'Zurücksetzungs-E-Mail gesendet!',
  },
};
