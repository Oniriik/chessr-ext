export interface Opening {
  eco: string;
  name: string;
  moves: string[];  // UCI format: e2e4, e7e5, etc.
  fen?: string;     // Position after moves
}

export interface OpeningNode {
  move: string;
  name?: string;
  eco?: string;
  children: Map<string, OpeningNode>;
  isMainLine?: boolean;
}

// Main openings database
export const OPENINGS: Opening[] = [
  // King's Pawn Openings (1.e4)
  { eco: 'B00', name: 'King\'s Pawn', moves: ['e2e4'] },

  // Sicilian Defense
  { eco: 'B20', name: 'Sicilienne', moves: ['e2e4', 'c7c5'] },
  { eco: 'B21', name: 'Sicilienne - Grand Prix', moves: ['e2e4', 'c7c5', 'f2f4'] },
  { eco: 'B22', name: 'Sicilienne - Alapin', moves: ['e2e4', 'c7c5', 'c2c3'] },
  { eco: 'B23', name: 'Sicilienne Fermée', moves: ['e2e4', 'c7c5', 'b1c3'] },
  { eco: 'B30', name: 'Sicilienne - Rossolimo', moves: ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'f1b5'] },
  { eco: 'B33', name: 'Sicilienne - Sveshnikov', moves: ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'e7e5'] },
  { eco: 'B90', name: 'Sicilienne - Najdorf', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'] },
  { eco: 'B96', name: 'Sicilienne - Najdorf 6.Bg5', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6', 'c1g5'] },
  { eco: 'B80', name: 'Sicilienne - Scheveningen', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'e7e6'] },
  { eco: 'B54', name: 'Sicilienne - Dragon', moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'g7g6'] },

  // French Defense
  { eco: 'C00', name: 'Défense Française', moves: ['e2e4', 'e7e6'] },
  { eco: 'C01', name: 'Française - Variante d\'échange', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4d5'] },
  { eco: 'C02', name: 'Française - Avance', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'e4e5'] },
  { eco: 'C03', name: 'Française - Tarrasch', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1d2'] },
  { eco: 'C11', name: 'Française - Classique', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6'] },
  { eco: 'C15', name: 'Française - Winawer', moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4'] },

  // Caro-Kann Defense
  { eco: 'B10', name: 'Défense Caro-Kann', moves: ['e2e4', 'c7c6'] },
  { eco: 'B12', name: 'Caro-Kann - Avance', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4e5'] },
  { eco: 'B13', name: 'Caro-Kann - Échange', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4d5', 'c6d5'] },
  { eco: 'B14', name: 'Caro-Kann - Panov', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4d5', 'c6d5', 'c2c4'] },
  { eco: 'B17', name: 'Caro-Kann - Steinitz', moves: ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5'] },

  // Italian Game
  { eco: 'C50', name: 'Partie Italienne', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
  { eco: 'C51', name: 'Gambit Evans', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'b2b4'] },
  { eco: 'C53', name: 'Giuoco Piano', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3'] },
  { eco: 'C54', name: 'Giuoco Piano - 4 Cavaliers', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6'] },

  // Ruy Lopez / Spanish
  { eco: 'C60', name: 'Partie Espagnole', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'] },
  { eco: 'C63', name: 'Espagnole - Schliemann', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'f7f5'] },
  { eco: 'C65', name: 'Espagnole - Berlin', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6'] },
  { eco: 'C68', name: 'Espagnole - Échange', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5c6'] },
  { eco: 'C78', name: 'Espagnole - Arkhangelsk', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'b7b5', 'a4b3', 'f8b4'] },
  { eco: 'C84', name: 'Espagnole - Centre fermé', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'] },
  { eco: 'C88', name: 'Espagnole - Marshall', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7', 'f1e1', 'b7b5', 'a4b3', 'e8g8', 'c2c3', 'd7d5'] },

  // Scotch Game
  { eco: 'C45', name: 'Partie Écossaise', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4'] },
  { eco: 'C45', name: 'Écossaise - Classique', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4'] },

  // Petrov Defense
  { eco: 'C42', name: 'Défense Petrov', moves: ['e2e4', 'e7e5', 'g1f3', 'g8f6'] },
  { eco: 'C43', name: 'Petrov - 3.d4', moves: ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'd2d4'] },

  // Scandinavian Defense
  { eco: 'B01', name: 'Défense Scandinave', moves: ['e2e4', 'd7d5'] },
  { eco: 'B01', name: 'Scandinave - 2...Qxd5', moves: ['e2e4', 'd7d5', 'e4d5', 'd8d5'] },
  { eco: 'B01', name: 'Scandinave - Moderne', moves: ['e2e4', 'd7d5', 'e4d5', 'g8f6'] },

  // Pirc Defense
  { eco: 'B07', name: 'Défense Pirc', moves: ['e2e4', 'd7d6', 'd2d4', 'g8f6', 'b1c3', 'g7g6'] },

  // Queen's Pawn Openings (1.d4)
  { eco: 'D00', name: 'Pion Dame', moves: ['d2d4'] },

  // Queen's Gambit
  { eco: 'D06', name: 'Gambit Dame', moves: ['d2d4', 'd7d5', 'c2c4'] },
  { eco: 'D10', name: 'Gambit Dame - Slave', moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6'] },
  { eco: 'D30', name: 'Gambit Dame Refusé', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6'] },
  { eco: 'D31', name: 'GDR - Défense Semi-Slave', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'c7c6'] },
  { eco: 'D35', name: 'GDR - Variante d\'échange', moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c4d5'] },
  { eco: 'D20', name: 'Gambit Dame Accepté', moves: ['d2d4', 'd7d5', 'c2c4', 'd5c4'] },

  // Indian Defenses
  { eco: 'A45', name: 'Défense Indienne', moves: ['d2d4', 'g8f6'] },
  { eco: 'E60', name: 'Défense Est-Indienne', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6'] },
  { eco: 'E62', name: 'Est-Indienne - Fianchetto', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'g2g3'] },
  { eco: 'E70', name: 'Est-Indienne - Classique', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4'] },
  { eco: 'E80', name: 'Est-Indienne - Sämisch', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'f2f3'] },
  { eco: 'E90', name: 'Est-Indienne - 5 Pions', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3'] },

  { eco: 'E00', name: 'Défense Ouest-Indienne', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'b7b6'] },
  { eco: 'E20', name: 'Défense Nimzo-Indienne', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'] },
  { eco: 'E32', name: 'Nimzo-Indienne - Classique', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'd1c2'] },
  { eco: 'E40', name: 'Nimzo-Indienne - Rubinstein', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3'] },

  // Grünfeld Defense
  { eco: 'D80', name: 'Défense Grünfeld', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d5'] },
  { eco: 'D85', name: 'Grünfeld - Échange', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d5', 'c4d5', 'f6d5', 'e2e4'] },

  // Dutch Defense
  { eco: 'A80', name: 'Défense Hollandaise', moves: ['d2d4', 'f7f5'] },
  { eco: 'A83', name: 'Hollandaise - Gambit Staunton', moves: ['d2d4', 'f7f5', 'e2e4'] },
  { eco: 'A87', name: 'Hollandaise - Leningrad', moves: ['d2d4', 'f7f5', 'g2g3', 'g8f6', 'f1g2', 'g7g6'] },

  // London System
  { eco: 'D00', name: 'Système de Londres', moves: ['d2d4', 'd7d5', 'c1f4'] },
  { eco: 'A46', name: 'Londres - vs Indien', moves: ['d2d4', 'g8f6', 'c1f4'] },

  // English Opening
  { eco: 'A10', name: 'Ouverture Anglaise', moves: ['c2c4'] },
  { eco: 'A20', name: 'Anglaise - Symétrique', moves: ['c2c4', 'e7e5'] },
  { eco: 'A30', name: 'Anglaise - Hedgehog', moves: ['c2c4', 'c7c5'] },

  // Réti Opening
  { eco: 'A04', name: 'Ouverture Réti', moves: ['g1f3', 'd7d5'] },
  { eco: 'A05', name: 'Réti - Système KIA', moves: ['g1f3', 'g8f6', 'g2g3'] },

  // King's Indian Attack
  { eco: 'A07', name: 'Attaque Est-Indienne', moves: ['g1f3', 'd7d5', 'g2g3', 'g8f6', 'f1g2'] },

  // Bird's Opening
  { eco: 'A02', name: 'Ouverture Bird', moves: ['f2f4'] },
  { eco: 'A02', name: 'Bird - Gambit From', moves: ['f2f4', 'e7e5'] },
];
