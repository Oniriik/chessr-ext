/**
 * Opening Book Service - Lichess Opening Explorer API integration
 */

import { logger } from './logger';

// Types
export interface BookMove {
  uci: string;
  san: string;
  whiteWins: number;
  draws: number;
  blackWins: number;
  whiteWinRate: number; // 0-100
  drawRate: number; // 0-100
  blackWinRate: number; // 0-100
  totalGames: number;
  averageRating?: number;
}

export interface OpeningInfo {
  name: string;
  eco: string;
}

export interface OpeningData {
  opening: OpeningInfo | null;
  moves: BookMove[];
  isInBook: boolean;
  totalGames: number;
}

interface LichessMove {
  uci: string;
  san: string;
  white: number;
  draws: number;
  black: number;
  averageRating?: number;
}

interface LichessResponse {
  opening?: {
    eco: string;
    name: string;
  };
  white: number;
  draws: number;
  black: number;
  moves: LichessMove[];
}

// Cache entry with TTL
interface CacheEntry {
  data: OpeningData;
  timestamp: number;
}

// Constants
const API_BASE = 'https://explorer.lichess.ovh/lichess';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 100;
const DEBOUNCE_MS = 300;
const RATE_LIMIT_RETRY_MS = 60 * 1000;

// Cache and state
const cache = new Map<string, CacheEntry>();
let lastRequestTime = 0;
let pendingRequest: Promise<OpeningData> | null = null;
let pendingFen: string | null = null;

/**
 * Calculate win rates from raw counts
 */
function calculateWinRates(white: number, draws: number, black: number): {
  whiteWinRate: number;
  drawRate: number;
  blackWinRate: number;
  totalGames: number;
} {
  const total = white + draws + black;
  if (total === 0) {
    return { whiteWinRate: 0, drawRate: 0, blackWinRate: 0, totalGames: 0 };
  }
  return {
    whiteWinRate: (white / total) * 100,
    drawRate: (draws / total) * 100,
    blackWinRate: (black / total) * 100,
    totalGames: total,
  };
}

/**
 * Transform Lichess API response to our format
 */
function transformResponse(response: LichessResponse): OpeningData {
  const { totalGames } = calculateWinRates(
    response.white,
    response.draws,
    response.black
  );

  const moves: BookMove[] = response.moves.map((move) => {
    const rates = calculateWinRates(move.white, move.draws, move.black);
    return {
      uci: move.uci,
      san: move.san,
      whiteWins: move.white,
      draws: move.draws,
      blackWins: move.black,
      whiteWinRate: rates.whiteWinRate,
      drawRate: rates.drawRate,
      blackWinRate: rates.blackWinRate,
      totalGames: rates.totalGames,
      averageRating: move.averageRating,
    };
  });

  // Sort by total games (most popular first)
  moves.sort((a, b) => b.totalGames - a.totalGames);

  return {
    opening: response.opening
      ? { name: response.opening.name, eco: response.opening.eco }
      : null,
    moves,
    isInBook: moves.length > 0,
    totalGames,
  };
}

/**
 * Clean old cache entries (LRU-style)
 */
function cleanCache(): void {
  if (cache.size <= MAX_CACHE_SIZE) return;

  const entries = Array.from(cache.entries());
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

  // Remove oldest entries until we're under the limit
  const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

/**
 * Check if cache entry is still valid
 */
function isValidCacheEntry(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Fetch opening data from Lichess API
 */
async function fetchFromAPI(fen: string): Promise<OpeningData> {
  const url = `${API_BASE}?variant=standard&fen=${encodeURIComponent(fen)}`;

  const response = await fetch(url);

  if (response.status === 429) {
    logger.warn('[opening] Rate limited, waiting 60s');
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_RETRY_MS));
    return fetchFromAPI(fen);
  }

  if (!response.ok) {
    throw new Error(`Lichess API error: ${response.status}`);
  }

  const data: LichessResponse = await response.json();
  return transformResponse(data);
}

/**
 * Fetch opening data with caching and debouncing
 */
export async function fetchOpeningData(fen: string): Promise<OpeningData> {
  // Check cache first
  const cached = cache.get(fen);
  if (cached && isValidCacheEntry(cached)) {
    logger.log('[opening] Cache hit:', cached.data.opening?.name ?? 'Unknown');
    return cached.data;
  }

  // If there's already a pending request for this FEN, return it
  if (pendingFen === fen && pendingRequest) {
    return pendingRequest;
  }

  // Debounce: wait if we just made a request
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < DEBOUNCE_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, DEBOUNCE_MS - timeSinceLastRequest)
    );
  }

  // Create new request
  pendingFen = fen;
  pendingRequest = fetchFromAPI(fen)
    .then((data) => {
      // Store in cache
      cache.set(fen, { data, timestamp: Date.now() });
      cleanCache();

      logger.log(
        '[opening] Fetched:',
        data.opening?.name ?? 'Unknown position',
        `(${data.moves.length} moves)`
      );

      return data;
    })
    .catch((error) => {
      logger.error('[opening] API error:', error);
      // Return empty data on error
      return {
        opening: null,
        moves: [],
        isInBook: false,
        totalGames: 0,
      };
    })
    .finally(() => {
      pendingFen = null;
      pendingRequest = null;
      lastRequestTime = Date.now();
    });

  return pendingRequest;
}

/**
 * Fetch popular openings for a given first move
 * Used for the repertoire selector
 */
export async function fetchPopularOpenings(
  firstMove: 'e4' | 'd4' | 'c4' | 'Nf3'
): Promise<OpeningData> {
  // FEN after each first move
  const fenAfterMove: Record<string, string> = {
    e4: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    d4: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1',
    c4: 'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1',
    Nf3: 'rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1',
  };

  const fen = fenAfterMove[firstMove];
  return fetchOpeningData(fen);
}

/**
 * Get win rate for a specific color
 */
export function getWinRateForColor(
  move: BookMove,
  color: 'white' | 'black'
): number {
  return color === 'white' ? move.whiteWinRate : move.blackWinRate;
}

/**
 * Clear the cache (useful for testing)
 */
export function clearCache(): void {
  cache.clear();
}
