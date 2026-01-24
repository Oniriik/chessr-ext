// Opening database with common chess openings
// Each opening has: name, ECO code, moves (in UCI format), and optional counters

export interface Opening {
  name: string;
  eco: string;
  moves: string[];  // UCI format: e2e4, e7e5, etc.
  description?: string;
  counters?: string[];  // Names of good counter-openings
}

export interface OpeningCategory {
  name: string;
  openings: Opening[];
}

// White openings (first move options)
export const WHITE_OPENINGS: OpeningCategory[] = [
  {
    name: "King's Pawn (e4)",
    openings: [
      {
        name: "Italian Game",
        eco: "C50",
        moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"],
        description: "Classique, contrôle du centre",
      },
      {
        name: "Ruy Lopez",
        eco: "C60",
        moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
        description: "Ouverture espagnole, très solide",
      },
      {
        name: "Scotch Game",
        eco: "C45",
        moves: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"],
        description: "Ouverture dynamique et agressive",
      },
      {
        name: "King's Gambit",
        eco: "C30",
        moves: ["e2e4", "e7e5", "f2f4"],
        description: "Gambit agressif, sacrifie un pion",
      },
      {
        name: "Vienna Game",
        eco: "C25",
        moves: ["e2e4", "e7e5", "b1c3"],
        description: "Flexible, prépare f4",
      },
    ],
  },
  {
    name: "Queen's Pawn (d4)",
    openings: [
      {
        name: "Queen's Gambit",
        eco: "D06",
        moves: ["d2d4", "d7d5", "c2c4"],
        description: "Gambit classique, très solide",
      },
      {
        name: "London System",
        eco: "D00",
        moves: ["d2d4", "d7d5", "c1f4"],
        description: "Système universel, facile à jouer",
      },
      {
        name: "Colle System",
        eco: "D05",
        moves: ["d2d4", "d7d5", "g1f3", "g8f6", "e2e3"],
        description: "Solide et positionnel",
      },
      {
        name: "Catalan Opening",
        eco: "E00",
        moves: ["d2d4", "g8f6", "c2c4", "e7e6", "g2g3"],
        description: "Fianchetto puissant",
      },
    ],
  },
  {
    name: "Flank Openings",
    openings: [
      {
        name: "English Opening",
        eco: "A10",
        moves: ["c2c4"],
        description: "Flexible, contrôle c4",
      },
      {
        name: "Réti Opening",
        eco: "A04",
        moves: ["g1f3", "d7d5", "c2c4"],
        description: "Hypermoderne, attaque le centre à distance",
      },
      {
        name: "King's Indian Attack",
        eco: "A07",
        moves: ["g1f3", "d7d5", "g2g3"],
        description: "Système universel pour les blancs",
      },
    ],
  },
];

// Black defenses against e4
export const BLACK_VS_E4: Opening[] = [
  {
    name: "Sicilian Defense",
    eco: "B20",
    moves: ["e2e4", "c7c5"],
    description: "Défense la plus populaire, déséquilibrée",
    counters: ["Open Sicilian", "Alapin Variation", "Smith-Morra Gambit"],
  },
  {
    name: "French Defense",
    eco: "C00",
    moves: ["e2e4", "e7e6"],
    description: "Solide, structure de pions fermée",
    counters: ["Advance Variation", "Tarrasch Variation", "Exchange Variation"],
  },
  {
    name: "Caro-Kann Defense",
    eco: "B10",
    moves: ["e2e4", "c7c6"],
    description: "Très solide, structure saine",
    counters: ["Advance Variation", "Exchange Variation", "Panov Attack"],
  },
  {
    name: "Pirc Defense",
    eco: "B07",
    moves: ["e2e4", "d7d6"],
    description: "Hypermoderne, fianchetto prévu",
    counters: ["Austrian Attack", "Classical Variation"],
  },
  {
    name: "Scandinavian Defense",
    eco: "B01",
    moves: ["e2e4", "d7d5"],
    description: "Attaque directe du pion e4",
    counters: ["Main Line 2.exd5 Qxd5 3.Nc3"],
  },
  {
    name: "Alekhine's Defense",
    eco: "B02",
    moves: ["e2e4", "g8f6"],
    description: "Provoque l'avance des pions blancs",
    counters: ["Four Pawns Attack", "Exchange Variation"],
  },
  {
    name: "Open Game (e5)",
    eco: "C20",
    moves: ["e2e4", "e7e5"],
    description: "Classique, jeu ouvert",
    counters: ["Italian Game", "Ruy Lopez", "Scotch Game"],
  },
];

// Black defenses against d4
export const BLACK_VS_D4: Opening[] = [
  {
    name: "Queen's Gambit Declined",
    eco: "D30",
    moves: ["d2d4", "d7d5", "c2c4", "e7e6"],
    description: "Solide et classique",
    counters: ["Exchange Variation", "Carlsbad Structure"],
  },
  {
    name: "Queen's Gambit Accepted",
    eco: "D20",
    moves: ["d2d4", "d7d5", "c2c4", "d5c4"],
    description: "Accepte le gambit, jeu actif",
    counters: ["Main Line"],
  },
  {
    name: "Slav Defense",
    eco: "D10",
    moves: ["d2d4", "d7d5", "c2c4", "c7c6"],
    description: "Très solide, protège d5",
    counters: ["Exchange Slav", "Main Line"],
  },
  {
    name: "King's Indian Defense",
    eco: "E60",
    moves: ["d2d4", "g8f6", "c2c4", "g7g6"],
    description: "Hypermoderne, contre-attaque",
    counters: ["Classical Variation", "Sämisch Variation", "Four Pawns Attack"],
  },
  {
    name: "Nimzo-Indian Defense",
    eco: "E20",
    moves: ["d2d4", "g8f6", "c2c4", "e7e6", "b1c3", "f8b4"],
    description: "Très solide, cloue le cavalier",
    counters: ["Rubinstein Variation", "Classical Variation"],
  },
  {
    name: "Grünfeld Defense",
    eco: "D80",
    moves: ["d2d4", "g8f6", "c2c4", "g7g6", "b1c3", "d7d5"],
    description: "Dynamique, attaque le centre",
    counters: ["Exchange Variation", "Russian System"],
  },
  {
    name: "Dutch Defense",
    eco: "A80",
    moves: ["d2d4", "f7f5"],
    description: "Agressive, contrôle e4",
    counters: ["Staunton Gambit", "Classical Variation"],
  },
  {
    name: "Benoni Defense",
    eco: "A60",
    moves: ["d2d4", "g8f6", "c2c4", "c7c5"],
    description: "Asymétrique, jeu dynamique",
    counters: ["Modern Main Line", "Four Pawns Attack"],
  },
];

// Counter-openings for white against black defenses
export const WHITE_COUNTERS: Record<string, Opening[]> = {
  "Sicilian Defense": [
    {
      name: "Open Sicilian",
      eco: "B20",
      moves: ["e2e4", "c7c5", "g1f3", "d7d6", "d2d4"],
      description: "Ligne principale, jeu ouvert",
    },
    {
      name: "Alapin Variation",
      eco: "B22",
      moves: ["e2e4", "c7c5", "c2c3"],
      description: "Anti-Sicilienne solide",
    },
    {
      name: "Smith-Morra Gambit",
      eco: "B21",
      moves: ["e2e4", "c7c5", "d2d4", "c5d4", "c2c3"],
      description: "Gambit agressif",
    },
  ],
  "French Defense": [
    {
      name: "Advance Variation",
      eco: "C02",
      moves: ["e2e4", "e7e6", "d2d4", "d7d5", "e4e5"],
      description: "Gain d'espace, chaîne de pions",
    },
    {
      name: "Tarrasch Variation",
      eco: "C03",
      moves: ["e2e4", "e7e6", "d2d4", "d7d5", "b1d2"],
      description: "Évite le clouage Fb4",
    },
  ],
  "Caro-Kann Defense": [
    {
      name: "Advance Variation",
      eco: "B12",
      moves: ["e2e4", "c7c6", "d2d4", "d7d5", "e4e5"],
      description: "Gain d'espace",
    },
    {
      name: "Panov Attack",
      eco: "B14",
      moves: ["e2e4", "c7c6", "d2d4", "d7d5", "e4d5", "c6d5", "c2c4"],
      description: "Positions de type Gambit Dame",
    },
  ],
  "Open Game (e5)": [
    {
      name: "Italian Game",
      eco: "C50",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"],
      description: "Classique et naturel",
    },
    {
      name: "Ruy Lopez",
      eco: "C60",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
      description: "Le plus testé",
    },
    {
      name: "Scotch Game",
      eco: "C45",
      moves: ["e2e4", "e7e5", "g1f3", "b8c6", "d2d4"],
      description: "Ouverture rapide du centre",
    },
  ],
};

// Helper function to detect opening from move history
export function detectOpening(moves: string[]): Opening | null {
  // Combine all openings to search
  const allOpenings = [
    ...BLACK_VS_E4,
    ...BLACK_VS_D4,
    ...WHITE_OPENINGS.flatMap(cat => cat.openings),
  ];

  // Find the best match (longest matching prefix)
  let bestMatch: Opening | null = null;
  let bestMatchLength = 0;

  for (const opening of allOpenings) {
    const matchLength = getMatchingMoveCount(moves, opening.moves);
    if (matchLength > bestMatchLength && matchLength >= opening.moves.length) {
      bestMatch = opening;
      bestMatchLength = matchLength;
    }
  }

  // Also check for partial matches (opening in progress)
  if (!bestMatch) {
    for (const opening of allOpenings) {
      const matchLength = getMatchingMoveCount(moves, opening.moves);
      if (matchLength > bestMatchLength && matchLength >= 2) {
        bestMatch = opening;
        bestMatchLength = matchLength;
      }
    }
  }

  return bestMatch;
}

function getMatchingMoveCount(playedMoves: string[], openingMoves: string[]): number {
  let count = 0;
  for (let i = 0; i < Math.min(playedMoves.length, openingMoves.length); i++) {
    if (playedMoves[i] === openingMoves[i]) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// Get counter-openings for a detected black opening
export function getCounterOpenings(blackOpening: Opening): Opening[] {
  return WHITE_COUNTERS[blackOpening.name] || [];
}

// Get the next move for a selected opening
export function getNextOpeningMove(selectedOpening: Opening, playedMoves: string[]): string | null {
  if (playedMoves.length < selectedOpening.moves.length) {
    return selectedOpening.moves[playedMoves.length];
  }
  return null;
}
