/**
 * openingHandler - WebSocket message handler for opening book requests
 * Proxies requests to Lichess Explorer API with caching and rate limiting
 */

import type { WebSocket } from 'ws';

export interface Client {
  ws: WebSocket;
  user: {
    id: string;
    email: string;
  };
}

export interface OpeningMessage {
  type: 'get_opening';
  requestId: string;
  fen: string;
}

// Types from Lichess API
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

// Our response format
interface BookMove {
  uci: string;
  san: string;
  whiteWins: number;
  draws: number;
  blackWins: number;
  whiteWinRate: number;
  drawRate: number;
  blackWinRate: number;
  totalGames: number;
  averageRating?: number;
}

interface OpeningData {
  opening: { name: string; eco: string } | null;
  moves: BookMove[];
  isInBook: boolean;
  totalGames: number;
  statsUnavailable?: boolean; // true when Lichess API failed
}

// Cache entry
interface CacheEntry {
  data: OpeningData;
  timestamp: number;
}

// Constants
const API_BASE = 'https://explorer.lichess.ovh/lichess';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes (server-side can be longer)
const MAX_CACHE_SIZE = 1000; // Server can hold more
const MIN_REQUEST_INTERVAL_MS = 500; // 500ms between Lichess API calls
const RATE_LIMIT_COOLDOWN_MS = 30_000; // 30s cooldown after 429

// Cache and state
const cache = new Map<string, CacheEntry>();
let lastRequestTime = 0;
let isRateLimited = false;
let rateLimitResetTime = 0;

// Request queue
interface QueuedRequest {
  fen: string;
  clients: Array<{ ws: WebSocket; requestId: string }>;
}
const requestQueue: QueuedRequest[] = [];
let isProcessingQueue = false;

// Stats
let stats = {
  cacheHits: 0,
  cacheMisses: 0,
  apiCalls: 0,
  rateLimitHits: 0,
};

/**
 * Calculate win rates from raw counts
 */
function calculateWinRates(white: number, draws: number, black: number) {
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
  const { totalGames } = calculateWinRates(response.white, response.draws, response.black);

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
    opening: response.opening ? { name: response.opening.name, eco: response.opening.eco } : null,
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
 * Fetch from Lichess API (no retries - fail fast on 429)
 */
async function fetchFromLichess(fen: string): Promise<OpeningData> {
  // Skip API call entirely if we're in cooldown
  if (isRateLimited && Date.now() < rateLimitResetTime) {
    return {
      opening: null,
      moves: [],
      isInBook: false,
      totalGames: 0,
      statsUnavailable: true,
    };
  }

  const url = `${API_BASE}?variant=standard&fen=${encodeURIComponent(fen)}`;

  stats.apiCalls++;
  const response = await fetch(url);

  if (response.status === 429) {
    stats.rateLimitHits++;
    isRateLimited = true;
    rateLimitResetTime = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    console.warn(`[OpeningHandler] Rate limited, cooldown ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
    return {
      opening: null,
      moves: [],
      isInBook: false,
      totalGames: 0,
      statsUnavailable: true,
    };
  }

  if (!response.ok) {
    throw new Error(`Lichess API error: ${response.status}`);
  }

  // Clear rate limit on successful request
  isRateLimited = false;

  const data: LichessResponse = await response.json();
  return transformResponse(data);
}

/**
 * Process the request queue
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue || requestQueue.length === 0) return;

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const request = requestQueue.shift()!;

    // Check cache again
    const cached = cache.get(request.fen);
    if (cached && isValidCacheEntry(cached)) {
      stats.cacheHits++;
      // Send to all waiting clients
      for (const client of request.clients) {
        sendOpeningResult(client.ws, client.requestId, cached.data);
      }
      continue;
    }

    stats.cacheMisses++;

    // Enforce minimum interval
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;
    if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
    }

    try {
      lastRequestTime = Date.now();
      const data = await fetchFromLichess(request.fen);

      // Store in cache
      cache.set(request.fen, { data, timestamp: Date.now() });
      cleanCache();

      // Send to all waiting clients
      for (const client of request.clients) {
        sendOpeningResult(client.ws, client.requestId, data);
      }
    } catch (error) {
      console.error('[OpeningHandler] API error:', error);
      const emptyData: OpeningData = {
        opening: null,
        moves: [],
        isInBook: false,
        totalGames: 0,
        statsUnavailable: true,
      };
      for (const client of request.clients) {
        sendOpeningResult(client.ws, client.requestId, emptyData);
      }
    }
  }

  isProcessingQueue = false;
}

/**
 * Send opening result to client
 */
function sendOpeningResult(ws: WebSocket, requestId: string, data: OpeningData): void {
  try {
    ws.send(
      JSON.stringify({
        type: 'opening_result',
        requestId,
        ...data,
      })
    );
  } catch (error) {
    // Client may have disconnected
  }
}

/**
 * Handle opening request message
 */
export function handleOpeningRequest(message: OpeningMessage, client: Client): void {
  const { requestId, fen } = message;

  if (!requestId || !fen) {
    client.ws.send(
      JSON.stringify({
        type: 'opening_error',
        requestId,
        error: 'Missing required fields: requestId or fen',
      })
    );
    return;
  }

  // Check cache first (immediate response)
  const cached = cache.get(fen);
  if (cached && isValidCacheEntry(cached)) {
    stats.cacheHits++;
    sendOpeningResult(client.ws, requestId, cached.data);
    return;
  }

  // Check if this FEN is already in the queue
  const existingRequest = requestQueue.find((r) => r.fen === fen);
  if (existingRequest) {
    // Add this client to the existing request
    existingRequest.clients.push({ ws: client.ws, requestId });
  } else {
    // Create new queue entry
    requestQueue.push({
      fen,
      clients: [{ ws: client.ws, requestId }],
    });
  }

  // Start processing
  processQueue();
}

/**
 * Get handler statistics
 */
export function getOpeningStats() {
  return {
    cache: {
      size: cache.size,
      maxSize: MAX_CACHE_SIZE,
      ttlMinutes: CACHE_TTL_MS / 60000,
    },
    queue: {
      pending: requestQueue.length,
      isProcessing: isProcessingQueue,
    },
    performance: {
      ...stats,
      hitRate: stats.cacheHits + stats.cacheMisses > 0
        ? ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1) + '%'
        : '0%',
    },
    rateLimiting: {
      isLimited: isRateLimited,
      resetIn: isRateLimited ? Math.max(0, rateLimitResetTime - Date.now()) : 0,
    },
  };
}

/**
 * Clear cache (for testing/admin)
 */
export function clearOpeningCache(): void {
  cache.clear();
  stats = { cacheHits: 0, cacheMisses: 0, apiCalls: 0, rateLimitHits: 0 };
}
