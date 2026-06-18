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
 */

import type { IEngine, SuggestionSearchParams } from './engineApi';
import type { EngineId, EngineCapabilities } from '../stores/engineStore';
import type { LabeledSuggestion, Suggestion } from './engineLabeler';
import { labelSuggestions } from './engineLabeler';
import { sendWs, onWsMessage } from './websocket';

const SEARCH_TIMEOUT_MS = 30_000;

function capsFor(id: EngineId): EngineCapabilities {
  if (id === 'maia3') {
    return { hasPersonality: false, hasUciElo: false, hasDynamism: false, hasKingSafety: false, hasVariety: false };
  }
  if (id === 'stockfish') {
    // Stockfish supports UCI Elo / UCI_LimitStrength but no Komodo-specific
    // personality / variety / dynamism / king safety knobs.
    return { hasPersonality: false, hasUciElo: true, hasDynamism: false, hasKingSafety: false, hasVariety: false };
  }
  if (id === 'rodent') {
    // Rodent exposes UCI_Elo + UCI_LimitStrength + PersonalityFile, but no
    // Komodo-style dynamism/kingSafety/variety knobs (they're encoded in
    // the personality files instead).
    return { hasPersonality: true, hasUciElo: true, hasDynamism: false, hasKingSafety: false, hasVariety: false };
  }
  // Komodo server-side always supports personality + ELO + variety
  return { hasPersonality: true, hasUciElo: true, hasDynamism: true, hasKingSafety: true, hasVariety: true };
}

export class ServerEngine implements IEngine {
  readonly id: EngineId;
  private _ready = false;
  private active: { requestId: string; off: () => void; timer: ReturnType<typeof setTimeout> } | null = null;
  constructor(engineId: EngineId) {
    this.id = engineId;
  }

  get ready(): boolean { return this._ready; }
  getCapabilities(): EngineCapabilities { return capsFor(this.id); }

  async init(): Promise<void> {
    this._ready = true;
  }

  async search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]> {
    if (!this._ready) throw new Error('ServerEngine not ready');
    if (this.active) await this.cancel();

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
      if (this.id === 'maia3') {
        sendWs({
          type: 'maia3_request',
          requestId,
          fen: params.fen,
          // Maia 3 takes raw float ELO — no bucketing.
          eloSelf: params.eloSelf ?? 1500,
          eloOppo: params.eloOppo ?? 1500,
          multiPv: params.multiPv,
        });
      } else if (this.id === 'rodent') {
        // Rodent native binary on the VPS — uses `eloTarget`, `imprecision`
        // (0..100 mapped server-side to EvalBlur), and a `personality`
        // string (filename stem like 'karpov' / 'default').
        const payload: any = {
          type: 'suggestion_request',
          requestId,
          engine: 'rodent',
          fen: params.fen,
          moves: params.moves ?? [],
          multiPv: params.multiPv,
          eloTarget: params.eloTarget ?? params.targetElo,
          limitStrength: params.limitStrength,
          imprecision: params.imprecision,
          personality: params.personality,
        };
        if (params.search) {
          payload.searchMode = params.search.mode;
          payload.searchNodes = params.search.nodes;
          payload.searchDepth = params.search.depth;
          payload.searchMovetime = params.search.movetime;
        }
        sendWs(payload);
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
