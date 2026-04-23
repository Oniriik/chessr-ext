/**
 * MaiaSuggestionEngine — runs Maia 2 inference via the custom WASM runtime
 * built from maia2-wasm/maia-runtime/.
 *
 * Worker-resident pipeline (CSP-safe Blob URL pattern, identical to Patricia):
 *   - JS sends FEN + ELO buckets via postMessage
 *   - Worker calls wasm_predict
 *   - Worker reads logits + value back from WASM heap, posts to main thread
 *   - Main thread applies legal-move mask, softmax, polyglot book lookup,
 *     mirrors black-to-move suggestions back to the original frame
 */

import { Chess } from 'chess.js';
import type { IEngine, SuggestionSearchParams } from './engineApi';
import type { LabeledSuggestion, Suggestion } from './engineLabeler';
import { labelSuggestions } from './engineLabeler';
import type { EngineCapabilities } from '../stores/engineStore';
import { PolyglotBook } from './polyglotBook';

const INIT_TIMEOUT_MS = 30_000;
const PREDICT_TIMEOUT_MS = 10_000;

const MAIA_CAPABILITIES: EngineCapabilities = {
  hasPersonality: false, hasUciElo: false, hasDynamism: false,
  hasKingSafety: false, hasVariety: false,
};

function eloBucketIndex(elo: number): number {
  if (elo < 1100) return 0;
  if (elo >= 2000) return 10;
  return Math.floor((elo - 1100) / 100) + 1;
}

function mirrorSquare(sq: string): string {
  return sq[0] + (9 - parseInt(sq[1], 10));
}
function mirrorMove(uci: string): string {
  const promo = uci.length > 4 ? uci.slice(4) : '';
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}

function winProbToCentipawn(p: number): number {
  const clamped = Math.max(1e-4, Math.min(1 - 1e-4, p));
  const cp = -400 * Math.log10((1 - clamped) / clamped);
  return Math.max(-2000, Math.min(2000, Math.round(cp)));
}

interface PendingPredict {
  resolve: (r: { logits: Float32Array; value: number }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class MaiaSuggestionEngine implements IEngine {
  readonly id = 'maia2' as const;

  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private _ready = false;
  private allMoves: string[] = [];
  private allMovesDict: Record<string, number> = {};
  private allMovesReversed: string[] = [];
  private book: PolyglotBook | null = null;
  private currentSearch: { abort: () => void } | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingPredict>();

  get ready(): boolean { return this._ready; }
  getCapabilities(): EngineCapabilities { return MAIA_CAPABILITIES; }

  async init(): Promise<void> {
    // Load the moves dictionary (1880 UCI strings) once.
    const movesUrl = browser.runtime.getURL('/engine/maia2/moves.json');
    const movesRes = await fetch(movesUrl);
    if (!movesRes.ok) throw new Error(`Failed to fetch moves.json: ${movesRes.status}`);
    this.allMoves = await movesRes.json();
    this.allMovesDict = Object.create(null);
    this.allMovesReversed = new Array(this.allMoves.length);
    for (let i = 0; i < this.allMoves.length; i++) {
      this.allMovesDict[this.allMoves[i]] = i;
      this.allMovesReversed[i] = this.allMoves[i];
    }

    // Bring up the Worker that hosts the WASM runtime.
    await this.bootWorker();

    // Polyglot opening book — non-fatal if it fails. Same instance pattern as
    // before; covers the first ~10-20 ply where Maia is unreliable.
    const book = new PolyglotBook();
    const zobristUrl = browser.runtime.getURL('/engine/maia2/zobrist.bin');
    const bookUrl = browser.runtime.getURL('/engine/book.bin');
    try {
      await book.load(zobristUrl, bookUrl);
      this.book = book;
    } catch {
      this.book = null;
    }

    this._ready = true;
  }

  private async bootWorker(): Promise<void> {
    const jsUrl = browser.runtime.getURL('/engine/maia2/maia.js');
    const wasmUrl = browser.runtime.getURL('/engine/maia2/maia.wasm');

    const res = await browser.runtime.sendMessage({
      type: 'fetchExtensionFile',
      path: new URL(jsUrl).pathname,
    }) as { text?: string; error?: string };
    if (res.error || !res.text) throw new Error(`Failed to fetch maia.js: ${res.error}`);

    const bootstrap = `
      ${res.text}
      const MAIA_WASM_URL = ${JSON.stringify(wasmUrl)};
      let predict = null;
      let logitsPtr = null, logitsCount = 0, valueOf = null;
      Module({
        locateFile: (path) => path.endsWith('.wasm') ? MAIA_WASM_URL : path,
      }).then((mod) => {
        const init = mod.cwrap('wasm_init', null, []);
        predict = mod.cwrap('wasm_predict', 'number', ['string', 'number', 'number']);
        const lp = mod.cwrap('wasm_logits_ptr', 'number', []);
        valueOf = mod.cwrap('wasm_value', 'number', []);
        logitsCount = mod.cwrap('wasm_logits_count', 'number', [])();
        init();
        logitsPtr = lp();
        self.__maiaModule = mod;
        postMessage({ __ready: true });
      });
      onmessage = (e) => {
        const d = e.data;
        if (!d) return;
        if (d.__predict) {
          if (!predict) { postMessage({ __reply: d.id, ok: false }); return; }
          const ok = predict(d.fen, BigInt(d.eloSelf), BigInt(d.eloOppo));
          if (!ok) { postMessage({ __reply: d.id, ok: false }); return; }
          // Re-read HEAPF32 (may have been replaced if memory grew).
          const logits = new Float32Array(self.__maiaModule.HEAPF32.buffer, logitsPtr, logitsCount).slice();
          const value = valueOf();
          postMessage({ __reply: d.id, ok: true, logits, value }, [logits.buffer]);
        }
      };
    `;

    const blob = new Blob([bootstrap], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.blobUrl);

    this.worker.addEventListener('message', (e) => this.onWorkerMessage(e));

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Maia worker init timeout')), INIT_TIMEOUT_MS);
      const onMsg = (e: MessageEvent) => {
        if (e.data && e.data.__ready) {
          clearTimeout(t);
          this.worker!.removeEventListener('message', onMsg);
          resolve();
        }
      };
      this.worker!.addEventListener('message', onMsg);
    });
  }

  private onWorkerMessage(e: MessageEvent) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (typeof d.__reply !== 'number') return;
    const pending = this.pending.get(d.__reply);
    if (!pending) return;
    this.pending.delete(d.__reply);
    clearTimeout(pending.timer);
    if (!d.ok) {
      pending.reject(new Error('predict failed (license / runtime)'));
    } else {
      pending.resolve({ logits: d.logits as Float32Array, value: d.value as number });
    }
  }

  private callPredict(fen: string, eloSelf: number, eloOppo: number): Promise<{ logits: Float32Array; value: number }> {
    if (!this.worker) return Promise.reject(new Error('Maia worker not ready'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Maia predict timeout'));
      }, PREDICT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ __predict: true, id, fen, eloSelf, eloOppo });
    });
  }

  async search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]> {
    if (!this._ready) throw new Error('MaiaSuggestionEngine not initialised');

    let aborted = false;
    this.currentSearch = { abort: () => { aborted = true; } };

    try {
      const fen = params.fen;
      const eloSelf = eloBucketIndex(params.eloSelf ?? 1500);
      const eloOppo = eloBucketIndex(params.eloOppo ?? 1500);
      const multiPv = Math.max(1, Math.min(3, params.multiPv));
      const useBook = params.useBook !== false;

      const isBlackToMove = fen.split(' ')[1] === 'b';

      // Fire the WASM predict (worker handles license check + inference)
      const { logits, value } = await this.callPredict(fen, eloSelf, eloOppo);
      if (aborted) throw new DOMException('Maia search cancelled', 'AbortError');

      // Build legal-moves mask using chess.js.
      // For black-to-move we mirrored INSIDE the WASM, so the logits indices
      // correspond to mirrored UCIs. We need to look at the mirrored board
      // here too to find which legal-move indices to keep.
      const legalUcisInModelFrame: string[] = [];
      const board = isBlackToMove ? this.mirrorChess(new Chess(fen)) : new Chess(fen);
      for (const m of board.moves({ verbose: true })) {
        const uci = m.from + m.to + (m.promotion ? m.promotion : '');
        if (uci in this.allMovesDict) legalUcisInModelFrame.push(uci);
      }
      const legalSet = new Set(legalUcisInModelFrame);

      // Mask + softmax over the full vector (matches maia2/inference.py exactly).
      const masked = new Float32Array(logits.length);
      for (let i = 0; i < logits.length; i++) {
        const uci = this.allMovesReversed[i];
        masked[i] = legalSet.has(uci) ? logits[i] : 0;
      }
      let maxV = -Infinity;
      for (let i = 0; i < masked.length; i++) if (masked[i] > maxV) maxV = masked[i];
      const probs = new Float32Array(masked.length);
      let sum = 0;
      for (let i = 0; i < masked.length; i++) { probs[i] = Math.exp(masked[i] - maxV); sum += probs[i]; }
      for (let i = 0; i < probs.length; i++) probs[i] /= sum;

      // Position eval (mirror back to original frame for black-to-move)
      let posWinProb = Math.max(0, Math.min(1, value / 2 + 0.5));
      if (isBlackToMove) posWinProb = 1 - posWinProb;
      const positionEval = winProbToCentipawn(posWinProb);

      // Optional polyglot book shortcut for opening positions.
      const bookHits = useBook ? (this.book?.lookup(new Chess(fen)) ?? []) : [];
      if (bookHits.length > 0) {
        const totalWeight = bookHits.reduce((s, h) => s + h.weight, 0) || 1;
        const top = bookHits.slice(0, multiPv);
        const suggestions: Suggestion[] = top.map((h, idx) => ({
          multipv: idx + 1,
          move: h.uci,
          evaluation: positionEval,
          depth: 0,
          winRate: (h.weight / totalWeight) * 100,
          drawRate: 0,
          lossRate: (1 - h.weight / totalWeight) * 100,
          mateScore: null,
          pv: [h.uci],
        }));
        return labelSuggestions(suggestions, fen);
      }

      // Top-N legal moves by Maia probability.
      const ranked: { uci: string; prob: number }[] = [];
      for (const uci of legalUcisInModelFrame) {
        const i = this.allMovesDict[uci];
        let outUci = uci;
        if (isBlackToMove) outUci = mirrorMove(uci);
        ranked.push({ uci: outUci, prob: probs[i] });
      }
      ranked.sort((a, b) => b.prob - a.prob);

      const top = ranked.slice(0, multiPv);
      const suggestions: Suggestion[] = top.map((m, idx) => ({
        multipv: idx + 1,
        move: m.uci,
        evaluation: positionEval,
        depth: 0,
        winRate: m.prob * 100,
        drawRate: 0,
        lossRate: (1 - m.prob) * 100,
        mateScore: null,
        pv: [m.uci],
      }));
      return labelSuggestions(suggestions, fen);
    } finally {
      this.currentSearch = null;
    }
  }

  private mirrorChess(board: Chess): Chess {
    // Same FEN-mirror logic the C++ runtime uses — keeps the JS legal-move
    // mask aligned with the WASM-produced logits frame.
    const [pieces, turn, castling, ep, half, full] = board.fen().split(' ');
    const rows = pieces.split('/').reverse().map(r =>
      r.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''),
    );
    const flippedCastling = castling === '-' ? '-' :
      castling.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('');
    const flippedEp = ep === '-' ? '-' : (ep[0] + (9 - parseInt(ep[1], 10)));
    const flippedFen = [rows.join('/'), turn === 'w' ? 'b' : 'w', flippedCastling, flippedEp, half, full].join(' ');
    return new Chess(flippedFen);
  }

  async newGame(): Promise<void> { /* stateless model */ }

  async cancel(): Promise<void> {
    if (this.currentSearch) this.currentSearch.abort();
  }

  destroy(): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('Engine destroyed'));
    }
    this.pending.clear();
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this.blobUrl) { URL.revokeObjectURL(this.blobUrl); this.blobUrl = null; }
    this._ready = false;
  }
}
