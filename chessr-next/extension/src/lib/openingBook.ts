/**
 * Opening Book Service - Fetches opening data via WebSocket server
 * Server proxies to Lichess Opening Explorer API with caching and rate limiting
 */

import { logger } from './logger';
import { webSocketManager } from './webSocket';

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

// Local cache (shorter TTL since server also caches)
interface CacheEntry {
  data: OpeningData;
  timestamp: number;
}

const LOCAL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes local cache
const MAX_LOCAL_CACHE_SIZE = 50;
const REQUEST_TIMEOUT_MS = 10000; // 10 second timeout

const localCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<OpeningData>>();

let requestCounter = 0;

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `opening_${Date.now()}_${++requestCounter}`;
}

/**
 * Check if local cache entry is valid
 */
function isValidCacheEntry(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < LOCAL_CACHE_TTL_MS;
}

/**
 * Clean old local cache entries
 */
function cleanLocalCache(): void {
  if (localCache.size <= MAX_LOCAL_CACHE_SIZE) return;

  const entries = Array.from(localCache.entries());
  entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

  const toRemove = entries.slice(0, entries.length - MAX_LOCAL_CACHE_SIZE);
  for (const [key] of toRemove) {
    localCache.delete(key);
  }
}

/**
 * Fetch opening data via WebSocket
 */
async function fetchViaWebSocket(fen: string): Promise<OpeningData> {
  const requestId = generateRequestId();

  return new Promise((resolve) => {
    // Set up timeout
    const timeout = setTimeout(() => {
      webSocketManager.openingCallbacks.delete(requestId);
      logger.warn('[opening] Request timeout for:', fen.split(' ')[0]);
      resolve({
        opening: null,
        moves: [],
        isInBook: false,
        totalGames: 0,
      });
    }, REQUEST_TIMEOUT_MS);

    // Register callback
    webSocketManager.openingCallbacks.set(requestId, (data: unknown) => {
      clearTimeout(timeout);
      const response = data as {
        type: string;
        opening?: OpeningInfo;
        moves?: BookMove[];
        isInBook?: boolean;
        totalGames?: number;
        error?: string;
      };

      if (response.type === 'opening_error') {
        logger.warn('[opening] Server error:', response.error);
        resolve({
          opening: null,
          moves: [],
          isInBook: false,
          totalGames: 0,
        });
      } else {
        resolve({
          opening: response.opening || null,
          moves: response.moves || [],
          isInBook: response.isInBook || false,
          totalGames: response.totalGames || 0,
        });
      }
    });

    // Send request
    webSocketManager.send({
      type: 'get_opening',
      requestId,
      fen,
    });
  });
}

/**
 * Fetch opening data with caching
 */
export async function fetchOpeningData(fen: string): Promise<OpeningData> {
  // Check local cache first
  const cached = localCache.get(fen);
  if (cached && isValidCacheEntry(cached)) {
    logger.log('[opening] Local cache hit:', cached.data.opening?.name ?? 'Unknown');
    return cached.data;
  }

  // Check if request is already pending
  const pending = pendingRequests.get(fen);
  if (pending) {
    logger.log('[opening] Reusing pending request');
    return pending;
  }

  // Check if WebSocket is connected
  if (!webSocketManager.isConnected) {
    logger.warn('[opening] WebSocket not connected, returning empty');
    return {
      opening: null,
      moves: [],
      isInBook: false,
      totalGames: 0,
    };
  }

  // Create new request
  const promise = fetchViaWebSocket(fen)
    .then((data) => {
      // Store in local cache
      localCache.set(fen, { data, timestamp: Date.now() });
      cleanLocalCache();

      logger.log(
        '[opening] Received:',
        data.opening?.name ?? 'Unknown position',
        `(${data.moves.length} moves)`
      );

      return data;
    })
    .finally(() => {
      pendingRequests.delete(fen);
    });

  pendingRequests.set(fen, promise);
  return promise;
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
 * Clear the local cache
 */
export function clearCache(): void {
  localCache.clear();
  pendingRequests.clear();
}
