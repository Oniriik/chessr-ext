import { Translations } from '../types';

export const fr: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    myColor: 'Ma couleur',
    turn: 'Tour',
    white: 'Blancs',
    black: 'Noirs',
    lastGamePlayed: 'Dernière Partie Jouée',
  },

  analysis: {
    eval: 'Éval',
    centipawns: 'Centipawns',
    move: 'Coup',
    mateIn: 'Mat en',
    reanalyze: 'Re-analyser',
  },

  elo: {
    title: 'ELO Cible',
    display: 'Affichage Chess.com',
    antiCheat: 'Randomisation ELO ±100',
    fullStrength: 'ELO Max (3500)',
    fullStrengthDesc: 'Débloquer la puissance maximale du moteur à 3500 ELO',
  },

  personalities: {
    title: 'Personnalité',
    Default: {
      label: 'Par défaut',
      description: 'Personnalité la plus forte avec contrôle total sur le Contempt.',
    },
    Aggressive: {
      label: 'Agressif',
      description: 'Attaque sans relâche, préfère les pièces actives, privilégie la Dame.',
    },
    Defensive: {
      label: 'Défensif',
      description: 'Privilégie la sécurité du roi et une position solide avant tout.',
    },
    Active: {
      label: 'Actif',
      description: 'Tend vers les positions ouvertes et les pièces bien placées.',
    },
    Positional: {
      label: 'Positionnel',
      description: 'Jeu solide, manœuvres, positions plus fermées.',
    },
    Endgame: {
      label: 'Finale',
      description: 'Préfère gagner en promouvant un pion.',
    },
    Beginner: {
      label: 'Débutant',
      description: 'Ne comprend pas les fondamentaux, cherche à échecs et captures.',
    },
    Human: {
      label: 'Humain',
      description: 'Optimisé pour jouer comme un humain fort.',
    },
  },

  engine: {
    title: 'Paramètres Moteur',
    riskTaking: 'Prise de risque',
    riskTakingDesc: 'Niveau de risque accepté pour gagner',
    timePerMove: 'Temps',
    analysisLines: "Lignes d'analyse",
  },

  display: {
    title: 'Affichage',
    showArrows: 'Afficher les flèches',
    showEvalBar: "Afficher la barre d'éval",
    evalBarMode: "Mode d'affichage",
    evalBarModeEval: 'Évaluation',
    evalBarModeWinrate: '% Victoire',
    blunderThreshold: 'Seuil de gaffe',
  },

  suggestions: {
    title: 'Suggestions',
    numberOfSuggestions: 'Nombre de suggestions',
    useSameColor: 'Utiliser la même couleur',
    firstSuggestion: '1ère Suggestion',
    secondSuggestion: '2ème Suggestion',
    thirdSuggestion: '3ème Suggestion',
    singleColor: 'Couleur des suggestions',
    showQualityLabels: 'Afficher labels qualité',
    showQualityLabelsDesc: 'Affiche les étiquettes Meilleur/Sûr/Risqué sur les flèches',
    showEffectLabels: 'Afficher labels effets',
    showEffectLabelsDesc: 'Affiche les labels mat/échec/capture/promotion sur les flèches',
  },

  openings: {
    title: 'Ouvertures',
    nextMove: 'Prochain coup',
    completed: 'Ouverture terminée',
    detected: 'Ouverture détectée',
    waitingForWhite: 'En attente du premier coup des blancs...',
    noOpening: 'Aucune ouverture disponible',
  },

  settings: {
    title: 'Paramètres',
    language: 'Langue',
    automatic: 'Automatique',
    french: 'Français',
    english: 'English',
    spanish: 'Español',
    russian: 'Русский',
    german: 'Deutsch',
    portuguese: 'Português',
    hindi: 'हिन्दी',
    detected: 'détecté',
  },

  advanced: {
    title: 'Avancé',
    showAlwaysBestMoveFirst: 'Toujours afficher le meilleur coup en premier',
    showAlwaysBestMoveFirstDesc: 'La première suggestion est toujours le meilleur coup moteur.',
    allowBrilliant: 'Autoriser les coups brillants',
    allowBrilliantDesc: 'Affiche les coups qui sacrifient du matériel pour des positions fortes.',
  },

  feedback: {
    title: 'Détails des coups',
    showSuggestions: 'Afficher suggestions détaillées',
    showSuggestionsDesc: 'Affiche les cartes avec coups, effets et qualité',
    showRollingAccuracy: 'Afficher statistiques de jeu',
    showRollingAccuracyDesc: 'Affiche un widget avec précision et classification des coups pour toute la partie',
  },

  badges: {
    best: 'Meilleur',
    safe: 'Sûr',
    risky: 'Risqué',
    human: 'Humain',
    alt: 'Alt',
    promotion: 'Promotion',
    mate: 'Mat',
    check: 'Échec',
    capture: 'Capture',
    lowRisk: 'Risque faible',
    mediumRisk: 'Risque moyen',
    highRisk: 'Risque élevé',
  },

  tabs: {
    general: 'Général',
    display: 'Affichage',
    suggestions: 'Suggestions',
    feedback: 'Détails',
  },

  version: {
    title: 'Mise à jour requise',
    message: "Votre version de Chessr n'est plus supportée. Veuillez mettre à jour pour continuer à utiliser l'extension.",
    current: 'Actuelle',
    required: 'Requise',
    download: 'Télécharger',
  },

  auth: {
    login: 'Connexion',
    signup: 'Inscription',
    forgotPassword: 'Mot de passe oublié',
    loginSubtitle: 'Connectez-vous pour accéder à Chessr',
    signupSubtitle: 'Créez un compte pour commencer',
    resetSubtitle: 'Entrez votre email pour réinitialiser',
    email: 'Email',
    emailPlaceholder: 'email@exemple.com',
    password: 'Mot de passe',
    passwordPlaceholder: '••••••••',
    confirmPassword: 'Confirmer le mot de passe',
    loginButton: 'Se connecter',
    signupButton: "S'inscrire",
    resetButton: 'Envoyer le lien',
    forgotPasswordLink: 'Mot de passe oublié ?',
    noAccount: 'Pas de compte ?',
    signupLink: "S'inscrire",
    hasAccount: 'Déjà un compte ?',
    loginLink: 'Se connecter',
    backToLogin: 'Retour à la connexion',
    passwordMismatch: 'Les mots de passe ne correspondent pas',
    passwordTooShort: 'Le mot de passe doit contenir au moins 6 caractères',
    accountCreated: 'Compte créé !',
    verifyYourEmail: 'Vérifiez votre email',
    emailSentTo: 'Un email a été envoyé à :',
    resendEmail: 'Renvoyer l\'email',
    emailResent: 'Email envoyé !',
    resetEmailSent: 'Email de réinitialisation envoyé !',
  },
};
