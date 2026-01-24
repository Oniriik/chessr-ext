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
  },

  elo: {
    title: 'ELO Cible',
    display: 'Affichage Chess.com',
    antiCheat: 'Anti-triche: Randomisation ELO ±100',
  },

  modes: {
    title: 'Mode de Jeu',
    safe: {
      label: 'Safe',
      description: 'Jeu solide et positionnel. Accepte les nulles, évite les risques inutiles.',
    },
    balanced: {
      label: 'Équilibré',
      description: 'Style de jeu neutre. Ni trop prudent, ni trop risqué.',
    },
    blitz: {
      label: 'Blitz',
      description: 'Décisions rapides, légèrement agressif. Optimisé pour les parties rapides.',
    },
    positional: {
      label: 'Positionnel',
      description: 'Très solide et patient. Privilégie les avantages positionnels durables.',
    },
    aggressive: {
      label: 'Agressif',
      description: 'Cherche le mat rapidement. Évite les nulles, prend des risques pour compliquer.',
    },
    tactical: {
      label: 'Tactique',
      description: 'Cherche les combinaisons et sacrifices. Style tranchant et calculateur.',
    },
  },

  engine: {
    title: 'Paramètres Moteur',
    searchMode: 'Mode de recherche',
    depth: 'Profondeur',
    timePerMove: 'Temps par coup (ms)',
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
};
