/**
 * maiaHandler — WS → BullMQ Maia 2 native fallback.
 *
 * Triggered when the extension's WASM Maia engine fails to init (or when
 * `localStorage.chessrForceServer` includes 'maia2'). Returns suggestions
 * in the same shape as the Komodo path so the client `ServerEngine` can
 * forward them to the UI without any engine-aware branching.
 */

import {
  enqueueMaia,
  removePendingMaiaForUser,
  type MaiaJobData,
} from '../queue/maiaQueue.js';

export interface MaiaMessage {
  type: 'maia_request';
  requestId: string;
  fen: string;
  /** Pre-bucketed ELO 0..10 (eloBucketIndex applied on the client). */
  eloSelf?: number;
  eloOppo?: number;
  multiPv?: number;
}

type SendFn = (data: unknown) => void;

function isValidFen(fen: string): boolean {
  if (typeof fen !== 'string') return false;
  const parts = fen.split(' ');
  if (parts.length < 4) return false;
  return parts[0].split('/').length === 8;
}

export async function handleMaiaRequest(
  message: MaiaMessage,
  userId: string,
  send: SendFn,
): Promise<void> {
  const { requestId, fen, eloSelf, eloOppo, multiPv } = message;

  if (!requestId || !fen) {
    send({ type: 'maia_error', requestId, error: 'Missing requestId or fen' });
    return;
  }
  if (!isValidFen(fen)) {
    send({ type: 'maia_error', requestId, error: 'Invalid FEN' });
    return;
  }

  // Supersede any previous pending Maia request from this user — they
  // changed position before the old one started, the old result is moot.
  try { await removePendingMaiaForUser(userId); } catch { /* ignore */ }

  const data: MaiaJobData = {
    requestId,
    userId,
    fen,
    eloSelf: clampBucket(eloSelf),
    eloOppo: clampBucket(eloOppo),
    multiPv: Math.max(1, Math.min(3, multiPv ?? 1)),
  };

  try {
    const result = await enqueueMaia(data);
    // Same response shape as suggestion_response so the client's
    // ServerEngine handler can stay engine-agnostic.
    send({
      type: 'suggestion_response',
      requestId,
      fen: result.fen,
      personality: 'maia2',
      positionEval: result.positionEval / 100,  // client expects pawns
      mateIn: null,
      winRate: result.suggestions[0]?.winRate ?? 50,
      suggestions: result.suggestions,
      puzzleMode: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({ type: 'suggestion_error', requestId, error: msg });
  }
}

export async function handleUserDisconnectMaia(userId: string): Promise<void> {
  try { await removePendingMaiaForUser(userId); } catch { /* ignore */ }
}

function clampBucket(b: number | undefined): number {
  if (typeof b !== 'number' || !Number.isFinite(b)) return 5;
  return Math.max(0, Math.min(10, Math.round(b)));
}
