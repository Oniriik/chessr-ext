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
