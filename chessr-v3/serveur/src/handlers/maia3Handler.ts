/**
 * maia3Handler — WS → BullMQ Maia 3 ONNX fallback.
 *
 * Triggered when the extension's WASM Maia 3 fails to init (or when forced
 * via `localStorage.chessrForceServer = 'maia3'`). Returns suggestions in
 * the same shape as Komodo / Maia 2 so the client ServerEngine handler
 * stays engine-agnostic.
 */

import {
  enqueueMaia3,
  removePendingMaia3ForUser,
  type Maia3JobData,
} from '../queue/maia3Queue.js';

export interface Maia3Message {
  type: 'maia3_request';
  requestId: string;
  fen: string;
  /** Raw ELO float (no bucketing — Maia 3 is continuous). */
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

function clampElo(e: number | undefined): number {
  if (typeof e !== 'number' || !Number.isFinite(e)) return 1500;
  return Math.max(600, Math.min(2600, e));
}

export async function handleMaia3Request(
  message: Maia3Message,
  userId: string,
  send: SendFn,
): Promise<void> {
  const { requestId, fen, eloSelf, eloOppo, multiPv } = message;

  if (!requestId || !fen) {
    send({ type: 'maia3_error', requestId, error: 'Missing requestId or fen' });
    return;
  }
  if (!isValidFen(fen)) {
    send({ type: 'maia3_error', requestId, error: 'Invalid FEN' });
    return;
  }

  // Supersede any previous pending Maia 3 request from this user.
  try { await removePendingMaia3ForUser(userId); } catch { /* ignore */ }

  const data: Maia3JobData = {
    requestId,
    userId,
    fen,
    eloSelf: clampElo(eloSelf),
    eloOppo: clampElo(eloOppo),
    multiPv: Math.max(1, Math.min(5, multiPv ?? 1)),
  };

  try {
    const result = await enqueueMaia3(data);
    // Same shape as suggestion_response so client handles uniformly.
    send({
      type: 'suggestion_response',
      requestId,
      fen: result.fen,
      personality: 'maia3',
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

export async function handleUserDisconnectMaia3(userId: string): Promise<void> {
  try { await removePendingMaia3ForUser(userId); } catch { /* ignore */ }
}
