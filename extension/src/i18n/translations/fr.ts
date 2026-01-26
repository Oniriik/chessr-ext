import { Translations } from '../types';

export const fr: Translations = {
  app: {
    name: 'Chessr',
  },

  player: {
    title: 'Je joue',
    white: '⬜ Blancs',
    black: '⬛ Noirs',
    switch: 'Changer',
    redetect: 'Re-détecter',
  },

  analysis: {
    eval: 'Éval',
    centipawns: 'Centipawns',
    move: 'Coup',
    mateIn: 'Mat en',
    depth: 'Profondeur',
    reanalyze: 'Re-analyser',
  },

  elo: {
    title: 'ELO Cible',
    display: 'Affichage Chess.com',
    antiCheat: 'Randomisation ELO ±100',
  },

  modes: {
    title: 'Mode de Jeu',
    default: {
      label: 'Par défaut',
      description: 'Paramètres Komodo par défaut. Jeu moteur pur sans ajustements.',
    },
    safe: {
      label: 'Prudent',
      description: 'Jeu prudent. Accepte les nulles, protège le roi, structure solide.',
    },
    balanced: {
      label: 'Équilibré',
      description: 'Jeu neutre humain. Ni trop prudent, ni trop risqué.',
    },
    positional: {
      label: 'Positionnel',
      description: 'Jeu stratégique. Structure solide, planification à long terme.',
    },
    aggressive: {
      label: 'Agressif',
      description: 'Jeu offensif. Évite les nulles, sacrifie pour l\'initiative.',
    },
    tactical: {
      label: 'Tactique',
      description: 'Cherche les complications et combinaisons. Style tranchant.',
    },
    creative: {
      label: 'Créatif',
      description: 'Jeu imprévisible avec des coups surprenants.',
    },
    inhuman: {
      label: 'Inhumain',
      description: 'Force moteur pure. Puissance maximale, sans patterns humains.',
    },
  },

  engine: {
    title: 'Paramètres Moteur',
    searchMode: 'Mode de recherche',
    depth: 'Profondeur',
    timePerMove: 'Temps',
    analysisLines: "Lignes d'analyse",
  },

  display: {
    title: 'Affichage',
    showArrows: 'Afficher les flèches',
    showEvalBar: "Afficher la barre d'éval",
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
    detected: 'détecté',
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
