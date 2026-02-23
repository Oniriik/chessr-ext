/**
 * Opening Database - Fetches from eco.json GitHub repo + Lichess API for winrates
 *
 * Data source: https://github.com/hayatbiralem/eco.json
 * Contains 12,000+ openings with ECO codes
 */

import { Chess } from 'chess.js';
import { logger } from './logger';
import { fetchOpeningData } from './openingBook';

// ============================================
// TYPES
// ============================================

export interface Opening {
  eco: string;
  name: string;
  fen: string;
  moves: string; // SAN format: "1. e4 e5 2. Nf3 Nc6"
  firstMove: string;
  category: 'white' | 'black-e4' | 'black-d4' | 'black-c4' | 'black-nf3' | 'black-other';
}

export interface OpeningWithStats extends Opening {
  whiteWinRate: number;
  drawRate: number;
  blackWinRate: number;
  totalGames: number;
}

// ECO JSON raw format from GitHub
interface EcoJsonEntry {
  eco: string;
  name: string;
  moves: string;
  src?: string;
}

type EcoJsonData = Record<string, EcoJsonEntry>;

// ============================================
// CACHE & STORAGE
// ============================================

const STORAGE_KEY = 'chessr-openings-db-v3'; // v3: fixed category detection (odd plies = white, even = black)
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

let openingsCache: Opening[] | null = null;

// ECO files URLs
const ECO_BASE_URL = 'https://raw.githubusercontent.com/hayatbiralem/eco.json/master';
const ECO_FILES = ['ecoA.json', 'ecoB.json', 'ecoC.json', 'ecoD.json', 'ecoE.json'];

// ============================================
// FETCH FROM ECO.JSON GITHUB
// ============================================

/**
 * Determine category from moves
 * - If last move is white's (odd ply count) -> white opening
 * - If last move is black's (even ply count) -> black opening (categorized by white's first move)
 */
function categorizeOpening(moves: string): Opening['category'] {
  // Parse moves: "1. e4 e5 2. Nf3" -> ["e4", "e5", "Nf3"]
  const moveList = moves
    .replace(/\d+\.\s*/g, '') // Remove move numbers
    .split(/\s+/)
    .filter(m => m.length > 0);

  if (moveList.length === 0) return 'white';

  // Odd number of moves = last move is white's = white opening
  // Even number of moves = last move is black's = black opening
  const isWhiteOpening = moveList.length % 2 === 1;

  if (isWhiteOpening) {
    return 'white';
  }

  // Black opening - categorize by white's first move
  const whiteFirstMove = moveList[0]?.toLowerCase();
  if (whiteFirstMove === 'e4') return 'black-e4';
  if (whiteFirstMove === 'd4') return 'black-d4';
  if (whiteFirstMove === 'c4') return 'black-c4';
  if (whiteFirstMove === 'nf3') return 'black-nf3';

  return 'black-other';
}

/**
 * Extract first move from SAN string
 * For white openings: returns white's first move (e4, d4, etc.)
 * For black openings: returns black's first move (c5, e5, e6, etc.)
 */
function extractFirstMove(moves: string, category: Opening['category']): string {
  // Parse moves: "1. e4 e5 2. Nf3" -> ["e4", "e5", "Nf3"]
  const moveList = moves
    .replace(/\d+\.\s*/g, '') // Remove move numbers
    .split(/\s+/)
    .filter(m => m.length > 0);

  if (category === 'white') {
    // White opening: return white's first move
    return moveList[0] || '';
  } else {
    // Black opening: return black's first move (second move in the list)
    return moveList[1] || moveList[0] || '';
  }
}

/**
 * Convert SAN moves to FEN using chess.js
 */
function movesToFen(sanMoves: string): string {
  try {
    const chess = new Chess();
    // Parse moves like "1. e4 e5 2. Nf3 Nc6"
    const moves = sanMoves
      .replace(/\d+\.\s*/g, '') // Remove move numbers
      .split(/\s+/)
      .filter(m => m.length > 0);

    for (const move of moves) {
      const result = chess.move(move);
      if (!result) break;
    }

    return chess.fen();
  } catch {
    return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  }
}

/**
 * Fetch a single ECO file from GitHub
 */
async function fetchEcoFile(filename: string): Promise<Opening[]> {
  const url = `${ECO_BASE_URL}/${filename}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data: EcoJsonData = await response.json();

    // Convert to our Opening format
    const openings: Opening[] = [];

    for (const [fen, entry] of Object.entries(data)) {
      if (!entry.name || !entry.eco) continue;

      const category = categorizeOpening(entry.moves);
      openings.push({
        eco: entry.eco,
        name: entry.name,
        fen: fen,
        moves: entry.moves,
        firstMove: extractFirstMove(entry.moves, category),
        category,
      });
    }

    return openings;
  } catch (error) {
    logger.error(`[openings] Failed to fetch ${filename}:`, error);
    return [];
  }
}

/**
 * Fetch all ECO files from GitHub
 */
export async function fetchAllOpeningsFromGitHub(): Promise<Opening[]> {
  logger.log('[openings] Fetching from GitHub eco.json...');

  const results = await Promise.all(ECO_FILES.map(fetchEcoFile));
  const allOpenings = results.flat();

  logger.log(`[openings] Fetched ${allOpenings.length} openings from GitHub`);

  return allOpenings;
}

/**
 * Load openings from cache or fetch from GitHub
 */
export async function loadOpenings(): Promise<Opening[]> {
  // Return memory cache if available
  if (openingsCache) {
    return openingsCache;
  }

  // Try to load from localStorage
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const { data, timestamp } = JSON.parse(stored);
      if (Date.now() - timestamp < CACHE_TTL) {
        openingsCache = data;
        logger.log(`[openings] Loaded ${data.length} openings from cache`);
        return data;
      }
    }
  } catch {
    // Ignore cache errors
  }

  // Fetch from GitHub
  const openings = await fetchAllOpeningsFromGitHub();

  if (openings.length > 0) {
    // Save to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        data: openings,
        timestamp: Date.now(),
      }));
    } catch {
      // Ignore storage errors (quota exceeded, etc.)
    }

    openingsCache = openings;
  } else {
    // Fallback to local data
    openingsCache = getLocalOpenings();
    logger.log(`[openings] Using ${openingsCache.length} local fallback openings`);
  }

  return openingsCache;
}

// ============================================
// SEARCH & FILTER
// ============================================

/**
 * Search openings by name or ECO code
 */
export async function searchOpenings(
  query: string,
  options?: {
    category?: Opening['category'];
    firstMove?: string;
    limit?: number;
  }
): Promise<Opening[]> {
  const openings = await loadOpenings();
  const normalizedQuery = query.toLowerCase().trim();

  let results = openings;

  // Filter by category
  if (options?.category) {
    results = results.filter(o => o.category === options.category);
  }

  // Filter by first move
  if (options?.firstMove) {
    results = results.filter(o => o.firstMove.toLowerCase() === options.firstMove!.toLowerCase());
  }

  // Search by name, ECO, first move, or category keywords
  if (normalizedQuery) {
    // Check for category keywords
    const categoryKeywords: Record<string, Opening['category'][]> = {
      'white': ['white'],
      'black': ['black-e4', 'black-d4', 'black-c4', 'black-nf3', 'black-other'],
    };

    // White moves that have corresponding black responses
    const whiteMoves = ['e4', 'd4', 'c4', 'nf3'];
    const isWhiteMove = whiteMoves.includes(normalizedQuery);

    const matchedCategories = categoryKeywords[normalizedQuery];

    // Check if query matches any firstMove in the database
    const matchesFirstMove = results.some(o => o.firstMove.toLowerCase() === normalizedQuery);

    if (isWhiteMove) {
      // White move search: return white openings with this firstMove AND black responses
      results = results.filter(o =>
        (o.category === 'white' && o.firstMove.toLowerCase() === normalizedQuery) ||
        o.category === `black-${normalizedQuery}`
      );
    } else if (matchesFirstMove) {
      // Other first move (like c5, e6) - filter by that move
      results = results.filter(o => o.firstMove.toLowerCase() === normalizedQuery);
    } else if (matchedCategories) {
      // Filter by category keyword (white/black)
      results = results.filter(o => matchedCategories.includes(o.category));
    } else {
      // Search by name or ECO
      results = results.filter(
        o =>
          o.name.toLowerCase().includes(normalizedQuery) ||
          o.eco.toLowerCase().includes(normalizedQuery)
      );
    }
  }

  // Sort by relevance (exact matches first, then by name length)
  results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === normalizedQuery || a.eco.toLowerCase() === normalizedQuery;
    const bExact = b.name.toLowerCase() === normalizedQuery || b.eco.toLowerCase() === normalizedQuery;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.name.length - b.name.length;
  });

  // Limit results
  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * Get openings by category
 */
export async function getOpeningsByCategory(category: Opening['category']): Promise<Opening[]> {
  const openings = await loadOpenings();
  return openings.filter(o => o.category === category);
}

/**
 * Get openings by first move (e.g., "e4", "d4")
 */
export async function getOpeningsByFirstMove(
  firstMove: string,
  category?: Opening['category']
): Promise<Opening[]> {
  const openings = await loadOpenings();
  return openings.filter(o => {
    const matchesMove = o.firstMove.toLowerCase() === firstMove.toLowerCase();
    const matchesCategory = !category || o.category === category;
    return matchesMove && matchesCategory;
  });
}

/**
 * Get unique first moves for a category
 */
export async function getFirstMoves(category: Opening['category']): Promise<string[]> {
  const openings = await loadOpenings();
  const filtered = openings.filter(o => o.category === category);
  const firstMoves = new Set(filtered.map(o => o.firstMove));
  return Array.from(firstMoves).sort();
}

// ============================================
// WINRATES FROM LICHESS
// ============================================

/**
 * Fetch winrates for an opening from Lichess
 */
export async function getOpeningWithStats(opening: Opening): Promise<OpeningWithStats> {
  try {
    const data = await fetchOpeningData(opening.fen);

    return {
      ...opening,
      whiteWinRate: data.moves.length > 0 ?
        data.moves.reduce((sum, m) => sum + m.whiteWinRate, 0) / data.moves.length : 50,
      drawRate: data.moves.length > 0 ?
        data.moves.reduce((sum, m) => sum + m.drawRate, 0) / data.moves.length : 0,
      blackWinRate: data.moves.length > 0 ?
        data.moves.reduce((sum, m) => sum + m.blackWinRate, 0) / data.moves.length : 50,
      totalGames: data.totalGames,
    };
  } catch {
    return {
      ...opening,
      whiteWinRate: 50,
      drawRate: 0,
      blackWinRate: 50,
      totalGames: 0,
    };
  }
}

/**
 * Fetch winrates for multiple openings
 */
export async function getOpeningsWithStats(openings: Opening[]): Promise<OpeningWithStats[]> {
  // Fetch in parallel but with a limit to avoid rate limiting
  const BATCH_SIZE = 5;
  const results: OpeningWithStats[] = [];

  for (let i = 0; i < openings.length; i += BATCH_SIZE) {
    const batch = openings.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(getOpeningWithStats));
    results.push(...batchResults);
  }

  return results;
}

// ============================================
// FIND COMPATIBLE OPENINGS (for deviation alternatives)
// ============================================

/**
 * Find openings compatible with the moves already played
 * Returns openings where the move sequence starts with the given moves
 * Sorted by win rate for the player's color
 */
export async function findCompatibleOpenings(
  moveHistory: string[],
  playerColor: 'white' | 'black',
  limit: number = 3
): Promise<OpeningWithStats[]> {
  if (moveHistory.length === 0) return [];

  const openings = await loadOpenings();

  // Filter openings that match the move history prefix
  const compatible = openings.filter(opening => {
    // Parse opening moves
    const openingMoves = opening.moves
      .replace(/\d+\.\s*/g, '')
      .split(/\s+/)
      .filter(m => m.length > 0);

    // Opening must be at least as long as move history
    if (openingMoves.length < moveHistory.length) return false;

    // Check if all played moves match the opening
    for (let i = 0; i < moveHistory.length; i++) {
      if (moveHistory[i] !== openingMoves[i]) return false;
    }

    // Filter by player color
    if (playerColor === 'white') {
      return opening.category === 'white';
    } else {
      return opening.category?.startsWith('black-');
    }
  });

  // Get stats for top candidates and sort by win rate
  const withStats = await getOpeningsWithStats(compatible.slice(0, 10));

  return withStats
    .sort((a, b) => {
      const aRate = playerColor === 'white' ? a.whiteWinRate : a.blackWinRate;
      const bRate = playerColor === 'white' ? b.whiteWinRate : b.blackWinRate;
      return bRate - aRate;
    })
    .slice(0, limit);
}

// ============================================
// LOCAL FALLBACK DATA (Most popular openings)
// ============================================

function getLocalOpenings(): Opening[] {
  return [
    // White openings - 1.e4
    { eco: 'C60', name: 'Ruy Lopez', fen: movesToFen('1. e4 e5 2. Nf3 Nc6 3. Bb5'), moves: '1. e4 e5 2. Nf3 Nc6 3. Bb5', firstMove: 'e4', category: 'white' },
    { eco: 'C50', name: 'Italian Game', fen: movesToFen('1. e4 e5 2. Nf3 Nc6 3. Bc4'), moves: '1. e4 e5 2. Nf3 Nc6 3. Bc4', firstMove: 'e4', category: 'white' },
    { eco: 'C44', name: 'Scotch Game', fen: movesToFen('1. e4 e5 2. Nf3 Nc6 3. d4'), moves: '1. e4 e5 2. Nf3 Nc6 3. d4', firstMove: 'e4', category: 'white' },
    { eco: 'B30', name: 'Open Sicilian', fen: movesToFen('1. e4 c5 2. Nf3'), moves: '1. e4 c5 2. Nf3', firstMove: 'e4', category: 'white' },

    // White openings - 1.d4
    { eco: 'D06', name: "Queen's Gambit", fen: movesToFen('1. d4 d5 2. c4'), moves: '1. d4 d5 2. c4', firstMove: 'd4', category: 'white' },
    { eco: 'D00', name: 'London System', fen: movesToFen('1. d4 d5 2. Bf4'), moves: '1. d4 d5 2. Bf4', firstMove: 'd4', category: 'white' },
    { eco: 'E00', name: 'Catalan Opening', fen: movesToFen('1. d4 Nf6 2. c4 e6 3. g3'), moves: '1. d4 Nf6 2. c4 e6 3. g3', firstMove: 'd4', category: 'white' },

    // White openings - 1.c4
    { eco: 'A20', name: 'English Opening', fen: movesToFen('1. c4'), moves: '1. c4', firstMove: 'c4', category: 'white' },

    // White openings - 1.Nf3
    { eco: 'A04', name: 'Réti Opening', fen: movesToFen('1. Nf3'), moves: '1. Nf3', firstMove: 'Nf3', category: 'white' },

    // Black vs 1.e4
    { eco: 'B20', name: 'Sicilian Defense', fen: movesToFen('1. e4 c5'), moves: '1. e4 c5', firstMove: 'c5', category: 'black-e4' },
    { eco: 'C00', name: 'French Defense', fen: movesToFen('1. e4 e6'), moves: '1. e4 e6', firstMove: 'e6', category: 'black-e4' },
    { eco: 'B10', name: 'Caro-Kann Defense', fen: movesToFen('1. e4 c6'), moves: '1. e4 c6', firstMove: 'c6', category: 'black-e4' },
    { eco: 'C40', name: 'Open Game', fen: movesToFen('1. e4 e5'), moves: '1. e4 e5', firstMove: 'e5', category: 'black-e4' },
    { eco: 'B01', name: 'Scandinavian Defense', fen: movesToFen('1. e4 d5'), moves: '1. e4 d5', firstMove: 'd5', category: 'black-e4' },
    { eco: 'B07', name: 'Pirc Defense', fen: movesToFen('1. e4 d6'), moves: '1. e4 d6', firstMove: 'd6', category: 'black-e4' },

    // Black vs 1.d4
    { eco: 'D30', name: "Queen's Gambit Declined", fen: movesToFen('1. d4 d5 2. c4 e6'), moves: '1. d4 d5 2. c4 e6', firstMove: 'd5', category: 'black-d4' },
    { eco: 'D10', name: 'Slav Defense', fen: movesToFen('1. d4 d5 2. c4 c6'), moves: '1. d4 d5 2. c4 c6', firstMove: 'd5', category: 'black-d4' },
    { eco: 'E60', name: "King's Indian Defense", fen: movesToFen('1. d4 Nf6 2. c4 g6'), moves: '1. d4 Nf6 2. c4 g6', firstMove: 'Nf6', category: 'black-d4' },
    { eco: 'E20', name: 'Nimzo-Indian Defense', fen: movesToFen('1. d4 Nf6 2. c4 e6 3. Nc3 Bb4'), moves: '1. d4 Nf6 2. c4 e6 3. Nc3 Bb4', firstMove: 'Nf6', category: 'black-d4' },
    { eco: 'D70', name: 'Grünfeld Defense', fen: movesToFen('1. d4 Nf6 2. c4 g6 3. Nc3 d5'), moves: '1. d4 Nf6 2. c4 g6 3. Nc3 d5', firstMove: 'Nf6', category: 'black-d4' },
    { eco: 'A80', name: 'Dutch Defense', fen: movesToFen('1. d4 f5'), moves: '1. d4 f5', firstMove: 'f5', category: 'black-d4' },

    // Black vs 1.c4
    { eco: 'A20', name: 'English Reversed Sicilian', fen: movesToFen('1. c4 e5'), moves: '1. c4 e5', firstMove: 'e5', category: 'black-c4' },
    { eco: 'A30', name: 'English Symmetrical', fen: movesToFen('1. c4 c5'), moves: '1. c4 c5', firstMove: 'c5', category: 'black-c4' },

    // Black vs 1.Nf3
    { eco: 'A04', name: 'Réti Accepted', fen: movesToFen('1. Nf3 d5'), moves: '1. Nf3 d5', firstMove: 'd5', category: 'black-nf3' },
  ];
}

// ============================================
// CLEAR CACHE
// ============================================

export function clearOpeningsCache(): void {
  openingsCache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
