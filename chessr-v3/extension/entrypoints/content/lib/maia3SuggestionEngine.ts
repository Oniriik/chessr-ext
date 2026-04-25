/**
 * Maia3SuggestionEngine — runs Maia 3 inference via ONNX Runtime Web.
 *
 * Pipeline:
 *   - JS sends FEN + raw ELO floats to the worker
 *   - Worker runs ORT.InferenceSession with the maia3_simplified.onnx model
 *   - Worker returns logits_move (4352-dim policy) + logits_value (LDW logits)
 *   - Main thread mirrors black-to-move FENs to white perspective, masks the
 *     policy by legal moves, applies softmax, demirrors UCIs back, and
 *     converts the LDW logits into a centipawn eval
 *
 * Differences vs Maia 2:
 *   - ELO is continuous (raw float) — no bucketing
 *   - 4352-dim move space (vs 1880 for Maia 2)
 *   - Output value is LDW (loss/draw/win) softmax → win prob, vs raw value
 *   - No opening book — direct policy from move 1 (per Chessr decision 2026-04-25)
 */

import { Chess } from 'chess.js';
import type { IEngine, SuggestionSearchParams } from './engineApi';
import type { LabeledSuggestion, Suggestion } from './engineLabeler';
import { labelSuggestions } from './engineLabeler';
import type { EngineCapabilities } from '../stores/engineStore';

const INIT_TIMEOUT_MS = 60_000;     // 60s — 45 MB model download
const PREDICT_TIMEOUT_MS = 10_000;

const MAIA3_CAPABILITIES: EngineCapabilities = {
  hasPersonality: false, hasUciElo: false, hasDynamism: false,
  hasKingSafety: false, hasVariety: false,
};

const POLICY_SIZE = 4352;
const VALUE_SIZE  = 3;

function mirrorSquare(sq: string): string {
  return sq[0] + (9 - parseInt(sq[1], 10));
}
function mirrorMove(uci: string): string {
  const promo = uci.length > 4 ? uci.slice(4) : '';
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}

function swapColorsInRank(rank: string): string {
  let out = '';
  for (const c of rank) {
    if (/[A-Z]/.test(c)) out += c.toLowerCase();
    else if (/[a-z]/.test(c)) out += c.toUpperCase();
    else out += c;
  }
  return out;
}
function swapCastlingRights(c: string): string {
  if (c === '-') return '-';
  const r = new Set(c.split(''));
  const s = new Set<string>();
  if (r.has('K')) s.add('k');
  if (r.has('Q')) s.add('q');
  if (r.has('k')) s.add('K');
  if (r.has('q')) s.add('Q');
  let o = '';
  for (const ch of ['K', 'Q', 'k', 'q']) if (s.has(ch)) o += ch;
  return o || '-';
}
function mirrorFEN(fen: string): string {
  const [pos, color, castling, ep, half, full] = fen.split(' ');
  const ranks = pos.split('/').slice().reverse().map(swapColorsInRank);
  return [
    ranks.join('/'),
    color === 'w' ? 'b' : 'w',
    swapCastlingRights(castling),
    ep !== '-' ? mirrorSquare(ep) : '-',
    half, full,
  ].join(' ');
}

/** Encode a FEN as a (64*12) one-hot Float32Array. White-to-move only —
 *  black-to-move FENs must be mirrored before calling this. */
function boardToTokens(fen: string): Float32Array {
  const piecePlacement = fen.split(' ')[0];
  const pieceTypes = ['P','N','B','R','Q','K','p','n','b','r','q','k'];
  const tensor = new Float32Array(64 * 12);
  const rows = piecePlacement.split('/');
  for (let rank = 0; rank < 8; rank++) {
    const row = 7 - rank;
    let file = 0;
    for (const ch of rows[rank]) {
      const n = parseInt(ch, 10);
      if (Number.isNaN(n)) {
        const idx = pieceTypes.indexOf(ch);
        if (idx >= 0) tensor[(row * 8 + file) * 12 + idx] = 1.0;
        file += 1;
      } else {
        file += n;
      }
    }
  }
  return tensor;
}

function winProbToCentipawn(p: number): number {
  const c = Math.max(1e-4, Math.min(1 - 1e-4, p));
  return Math.max(-2000, Math.min(2000, Math.round(-400 * Math.log10((1 - c) / c))));
}

interface PendingPredict {
  resolve: (r: { logitsMove: Float32Array; logitsValue: Float32Array }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Maia3SuggestionEngine implements IEngine {
  readonly id = 'maia3' as const;

  private worker: Worker | null = null;
  private workerBlobUrl: string | null = null;
  private _ready = false;
  private allMovesDict: Record<string, number> = {};
  private allMovesReversed: string[] = [];
  private currentSearch: { abort: () => void } | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingPredict>();

  get ready(): boolean { return this._ready; }
  getCapabilities(): EngineCapabilities { return MAIA3_CAPABILITIES; }

  async init(): Promise<void> {
    const t0 = Date.now();
    console.log('[Maia3] init starting…');

    // Load the move dictionary (4352 entries) so we can mask legal moves.
    const movesUrl = browser.runtime.getURL('/engine/maia3/all_moves.json');
    const movesRev = browser.runtime.getURL('/engine/maia3/all_moves_reversed.json');
    const tDict = Date.now();
    const [movesRes, revRes] = await Promise.all([fetch(movesUrl), fetch(movesRev)]);
    if (!movesRes.ok || !revRes.ok) throw new Error('Failed to fetch maia3 moves dict');
    this.allMovesDict = await movesRes.json();
    const reversedObj = await revRes.json() as Record<string, string>;
    this.allMovesReversed = new Array(POLICY_SIZE);
    for (const k in reversedObj) this.allMovesReversed[Number(k)] = reversedObj[k];
    console.log(`[Maia3] move dictionary loaded in ${Date.now() - tDict}ms`);

    // Boot the worker via Blob URL (MV3 + chess.com CSP forbids constructing
    // a Worker directly from chrome-extension://). We fetch the worker JS,
    // wrap it in a blob, then `new Worker(blobUrl)`. The worker itself still
    // does `importScripts(chrome-extension://.../ort.wasm.min.js)` which is
    // allowed because the ORT files are listed in web_accessible_resources.
    const workerUrl     = browser.runtime.getURL('/engine/maia3/maia3-worker.js');
    const ortRuntimeUrl = browser.runtime.getURL('/engine/maia3/ort/ort.wasm.min.js');
    const ortBaseUrl    = ortRuntimeUrl.replace(/ort\.wasm\.min\.js$/, '');
    const modelUrl      = browser.runtime.getURL('/engine/maia3/model.onnx');

    const tBlob = Date.now();
    const workerJsRes = await fetch(workerUrl);
    if (!workerJsRes.ok) throw new Error(`fetch maia3-worker.js: ${workerJsRes.status}`);
    const workerJs = await workerJsRes.text();
    const blob = new Blob([workerJs], { type: 'application/javascript' });
    this.workerBlobUrl = URL.createObjectURL(blob);
    console.log(`[Maia3] worker blob URL ready in ${Date.now() - tBlob}ms`);

    this.worker = new Worker(this.workerBlobUrl);
    this.worker.addEventListener('message', (e) => this.onWorkerMessage(e));

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Maia3 worker init timeout')), INIT_TIMEOUT_MS);
      const onMsg = (e: MessageEvent) => {
        const d = e.data;
        if (d?.type === 'log') {
          console.log(...d.args);
          return;
        }
        if (d?.type === 'progress') {
          console.log(`[Maia3] download ${d.progress}%`);
          return;
        }
        if (d?.type === 'status' && d.status === 'ready') {
          clearTimeout(t);
          this.worker!.removeEventListener('message', onMsg);
          console.log(`[Maia3] init ready in ${Date.now() - t0}ms`);
          resolve();
        } else if (d?.type === 'error' && d.id === undefined) {
          clearTimeout(t);
          this.worker!.removeEventListener('message', onMsg);
          reject(new Error(d.message || 'Maia3 init error'));
        }
      };
      this.worker!.addEventListener('message', onMsg);
      console.log('[Maia3] posting init to worker (modelUrl + ORT urls)');
      this.worker!.postMessage({ type: 'init', modelUrl, ortBaseUrl, ortRuntimeUrl });
    });

    this._ready = true;
  }

  private onWorkerMessage(e: MessageEvent) {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'inference-result' && typeof d.id === 'number') {
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      clearTimeout(p.timer);
      p.resolve({
        logitsMove:  new Float32Array(d.logitsMove),
        logitsValue: new Float32Array(d.logitsValue),
      });
    } else if (d.type === 'error' && typeof d.id === 'number') {
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      clearTimeout(p.timer);
      p.reject(new Error(d.message || 'inference failed'));
    }
  }

  private callPredict(tokens: Float32Array, eloSelf: number, eloOppo: number): Promise<{ logitsMove: Float32Array; logitsValue: Float32Array }> {
    if (!this.worker) return Promise.reject(new Error('worker not ready'));
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Maia3 predict timeout'));
      }, PREDICT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      // Transfer ownership of the buffer for zero-copy.
      this.worker!.postMessage({
        type: 'inference', id,
        tokens: tokens.buffer,
        eloSelfs: new Float32Array([eloSelf]).buffer,
        eloOppos: new Float32Array([eloOppo]).buffer,
        batchSize: 1,
      }, [tokens.buffer]);
    });
  }

  async search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]> {
    if (!this._ready) throw new Error('Maia3SuggestionEngine not initialised');

    let aborted = false;
    this.currentSearch = { abort: () => { aborted = true; } };

    try {
      const fen = params.fen;
      const eloSelf = params.eloSelf ?? 1500;
      const eloOppo = params.eloOppo ?? 1500;
      const multiPv = Math.max(1, Math.min(5, params.multiPv));

      const isBlackToMove = fen.split(' ')[1] === 'b';
      const fenInModelFrame = isBlackToMove ? mirrorFEN(fen) : fen;
      const tokens = boardToTokens(fenInModelFrame);

      const { logitsMove, logitsValue } = await this.callPredict(tokens, eloSelf, eloOppo);
      if (aborted) throw new DOMException('Maia3 search cancelled', 'AbortError');

      // LDW softmax → win prob
      const m = Math.max(logitsValue[0], logitsValue[1], logitsValue[2]);
      const eL = Math.exp(logitsValue[0] - m);
      const eD = Math.exp(logitsValue[1] - m);
      const eW = Math.exp(logitsValue[2] - m);
      const sumLDW = eL + eD + eW;
      let winProb = (eW + 0.5 * eD) / sumLDW;
      if (isBlackToMove) winProb = 1 - winProb;
      const positionEval = winProbToCentipawn(winProb);

      // Build legal-move mask in the model's frame.
      const board = new Chess(fenInModelFrame);
      const legalIndices: number[] = [];
      for (const mv of board.moves({ verbose: true })) {
        const uci = mv.from + mv.to + ((mv as { promotion?: string }).promotion || '');
        const idx = this.allMovesDict[uci];
        if (idx !== undefined) legalIndices.push(idx);
      }

      // Softmax over legal moves only (matches upstream processOutputsMaia3).
      const legalLogits = legalIndices.map((i) => logitsMove[i]);
      const lmax = Math.max(...legalLogits);
      const expL = legalLogits.map((l) => Math.exp(l - lmax));
      const sumE = expL.reduce((a, b) => a + b, 0) || 1;

      const ranked: { uci: string; prob: number }[] = [];
      for (let i = 0; i < legalIndices.length; i++) {
        let uci = this.allMovesReversed[legalIndices[i]];
        if (isBlackToMove) uci = mirrorMove(uci);
        ranked.push({ uci, prob: expL[i] / sumE });
      }
      ranked.sort((a, b) => b.prob - a.prob);

      const top = ranked.slice(0, multiPv);
      const suggestions: Suggestion[] = top.map((mv, idx) => ({
        multipv: idx + 1,
        move: mv.uci,
        evaluation: positionEval,
        depth: 0,
        winRate: mv.prob * 100,
        drawRate: 0,
        lossRate: (1 - mv.prob) * 100,
        mateScore: null,
        pv: [mv.uci],
      }));
      return labelSuggestions(suggestions, fen);
    } finally {
      this.currentSearch = null;
    }
  }

  async cancel(): Promise<void> {
    this.currentSearch?.abort();
    this.currentSearch = null;
  }

  async newGame(): Promise<void> { /* no state */ }

  destroy(): void {
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    if (this.workerBlobUrl) { URL.revokeObjectURL(this.workerBlobUrl); this.workerBlobUrl = null; }
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('engine destroyed')); }
    this.pending.clear();
    this._ready = false;
  }
}
