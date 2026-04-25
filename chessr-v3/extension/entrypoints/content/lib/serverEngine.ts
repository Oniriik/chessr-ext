/**
 * ServerEngine — IEngine implementation that proxies searches to the server
 * via WebSocket. Used as a fallback when a WASM engine fails to init (iOS
 * doesn't deliver .wasm, Windows AV strips bytes, old Chromium without SIMD,
 * etc.).
 *
 * Protocol (defined in chessr-v3/serveur/src/handlers/suggestionHandler.ts):
 *   → { type: 'suggestion_request', requestId, engine, fen, moves,
 *       targetElo, personality, multiPv, variety, limitStrength,
 *       searchMode, searchNodes, searchDepth, searchMovetime }
 *   ← { type: 'suggestion_response', requestId, fen, suggestions, ... }
 *   ← { type: 'suggestion_error',    requestId, error }
 *
 * For Maia 2 specifically: before sending `maia_request`, we check the
 * polyglot opening book first (same as the WASM MaiaSuggestionEngine
 * does). If the book hits, we return book moves immediately — saves a
 * WS round-trip in the opening AND keeps the user-visible behavior
 * identical between WASM and server-fallback paths (Maia is unreliable
 * for the first ~10–20 ply, so the book is the source of truth there).
 */

import { Chess } from 'chess.js';
import type { IEngine, SuggestionSearchParams } from './engineApi';
import type { EngineId, EngineCapabilities } from '../stores/engineStore';
import type { LabeledSuggestion, Suggestion } from './engineLabeler';
import { labelSuggestions } from './engineLabeler';
import { PolyglotBook } from './polyglotBook';
import { sendWs, onWsMessage } from './websocket';

const SEARCH_TIMEOUT_MS = 30_000;

function capsFor(id: EngineId): EngineCapabilities {
  if (id === 'maia2') {
    return { hasPersonality: false, hasUciElo: false, hasDynamism: false, hasKingSafety: false, hasVariety: false };
  }
  // Komodo server-side always supports personality + ELO + variety
  return { hasPersonality: true, hasUciElo: true, hasDynamism: true, hasKingSafety: true, hasVariety: true };
}

/** Map raw ELO to Maia's 0..10 bucket (mirror of eloBucketIndex in
 *  maiaSuggestionEngine.ts). Server side expects pre-bucketed values. */
function eloBucketIndex(elo: number): number {
  if (elo < 1100) return 0;
  if (elo >= 2000) return 10;
  return Math.floor((elo - 1100) / 100) + 1;
}

export class ServerEngine implements IEngine {
  readonly id: EngineId;
  private _ready = false;
  private active: { requestId: string; off: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  /** Polyglot opening book — only loaded for engineId === 'maia2'. Null
   *  for Komodo (Komodo handles its own opening through Dragon's book). */
  private book: PolyglotBook | null = null;

  constructor(engineId: EngineId) {
    this.id = engineId;
  }

  get ready(): boolean { return this._ready; }
  getCapabilities(): EngineCapabilities { return capsFor(this.id); }

  async init(): Promise<void> {
    // WebSocket is already up (content.tsx connects it at auth time).
    // Maia 2 server-fallback also loads the polyglot book to short-circuit
    // the opening (Maia hallucinates in the first 10-20 ply otherwise).
    if (this.id === 'maia2') {
      const book = new PolyglotBook();
      try {
        await book.load(
          browser.runtime.getURL('/engine/maia2/zobrist.bin'),
          browser.runtime.getURL('/engine/book.bin'),
        );
        this.book = book;
      } catch {
        // Book load is non-fatal — we'll just go straight to the server
        // for every position, including openings where Maia is weak.
        this.book = null;
      }
    }
    this._ready = true;
  }

  async search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]> {
    if (!this._ready) throw new Error('ServerEngine not ready');
    if (this.active) await this.cancel();

    // Maia 2 only: short-circuit through the polyglot book when the
    // current position is in opening theory. Mirrors what the WASM
    // MaiaSuggestionEngine does — keeps the fallback indistinguishable
    // from the WASM path for the user.
    if (this.id === 'maia2' && this.book && params.useBook !== false) {
      const hits = this.book.lookup(new Chess(params.fen));
      if (hits.length > 0) {
        const totalWeight = hits.reduce((s, h) => s + h.weight, 0) || 1;
        const top = hits.slice(0, Math.max(1, Math.min(3, params.multiPv)));
        const sugs: Suggestion[] = top.map((h, idx) => ({
          multipv: idx + 1,
          move: h.uci,
          evaluation: 0,            // book moves are openings → eval ≈ 0
          depth: 0,
          winRate: (h.weight / totalWeight) * 100,
          drawRate: 0,
          lossRate: (1 - h.weight / totalWeight) * 100,
          mateScore: null,
          pv: [h.uci],
        }));
        return labelSuggestions(sugs, params.fen);
      }
    }

    const requestId = `srv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise<LabeledSuggestion[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.cleanup();
        reject(new Error('ServerEngine search timeout'));
      }, SEARCH_TIMEOUT_MS);

      const off = onWsMessage((msg) => {
        if (!msg || msg.requestId !== requestId) return;

        if (msg.type === 'suggestion_response') {
          this.cleanup();
          const sugs: Suggestion[] = (msg.suggestions ?? []).map((s: any) => ({
            multipv: s.multipv ?? 1,
            move: s.move,
            evaluation: s.evaluation ?? 0,
            depth: s.depth ?? 0,
            winRate: s.winRate ?? 0,
            drawRate: s.drawRate ?? 0,
            lossRate: s.lossRate ?? 0,
            mateScore: s.mateScore ?? null,
            pv: s.pv ?? [s.move],
          }));
          resolve(labelSuggestions(sugs, params.fen));
          return;
        }
        if (msg.type === 'suggestion_error') {
          this.cleanup();
          reject(new Error(msg.error || 'server suggestion error'));
          return;
        }
      });

      this.active = { requestId, off, timer };

      // Map IEngine params → server protocol. Two distinct WS message
      // types: `maia_request` for the native Maia binary path,
      // `suggestion_request` for the Komodo Dragon path. Both come back
      // as `suggestion_response` so the receive handler stays unified.
      if (this.id === 'maia2') {
        sendWs({
          type: 'maia_request',
          requestId,
          fen: params.fen,
          eloSelf: eloBucketIndex(params.eloSelf ?? 1500),
          eloOppo: eloBucketIndex(params.eloOppo ?? 1500),
          multiPv: params.multiPv,
        });
      } else if (this.id === 'maia3') {
        sendWs({
          type: 'maia3_request',
          requestId,
          fen: params.fen,
          // Maia 3 takes raw float ELO — no bucketing.
          eloSelf: params.eloSelf ?? 1500,
          eloOppo: params.eloOppo ?? 1500,
          multiPv: params.multiPv,
        });
      } else {
        const payload: any = {
          type: 'suggestion_request',
          requestId,
          engine: this.id,
          fen: params.fen,
          moves: params.moves ?? [],
          multiPv: params.multiPv,
          targetElo: params.targetElo,
          personality: params.personality,
          limitStrength: params.limitStrength,
          variety: params.variety,
        };
        if (params.search) {
          payload.searchMode = params.search.mode;
          payload.searchNodes = params.search.nodes;
          payload.searchDepth = params.search.depth;
          payload.searchMovetime = params.search.movetime;
        }
        sendWs(payload);
      }
    });
  }

  async newGame(): Promise<void> { /* stateless from client's POV */ }

  async cancel(): Promise<void> {
    this.cleanup();
  }

  destroy(): void {
    this.cleanup();
    this._ready = false;
  }

  private cleanup() {
    if (this.active) {
      clearTimeout(this.active.timer);
      this.active.off();
      this.active = null;
    }
  }
}
