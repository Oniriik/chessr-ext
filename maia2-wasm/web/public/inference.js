// onnxruntime-web inference wrapper for Maia 2.
//
// Public API:
//   const engine = new MaiaEngine();
//   await engine.load({ modelUrl, movesUrl, threads, simd });
//   const result = await engine.predict({ fen, eloSelf, eloOppo });
//   await engine.setThreads(n);   // Recreates the session.
//
// `predict` returns:
//   {
//     moves: [{ uci, prob }, ...]   // top legal moves, sorted by prob desc
//     winProb,                      // 0..1, from side-to-move's perspective
//     elapsedMs,
//   }

import * as ort from "/ort/ort.all.bundle.min.mjs";
import { Chess } from "https://esm.sh/chess.js@1.0.0-beta.8";
import {
  boardToTensor, legalMovesMask, mirrorMove, mirroredBoard, NUM_CHANNELS,
} from "./encoding.js";
import { eloBucketIndex } from "./eloMap.js";

// All ORT WASM artifacts are served same-origin from /ort/.
ort.env.wasm.wasmPaths = "/ort/";

export class MaiaEngine {
  constructor() {
    this.session = null;
    this.modelUrl = null;
    this.modelBuffer = null;        // Cached model bytes — avoids refetch on thread change.
    this.allMoves = null;           // Array<string>
    this.allMovesDict = null;       // { uci: index }
    this.allMovesDictReversed = null; // [index] = uci
    this.threads = 1;
    this.simd = true;
    this.lastLoadMs = 0;
  }

  async load({ modelUrl, movesUrl, threads = 1, simd = true } = {}) {
    if (!modelUrl || !movesUrl) throw new Error("modelUrl and movesUrl required");
    if (!this.allMoves) {
      const res = await fetch(movesUrl);
      if (!res.ok) throw new Error(`failed to fetch moves: ${res.status}`);
      this.allMoves = await res.json();
      this.allMovesDict = Object.create(null);
      this.allMovesDictReversed = new Array(this.allMoves.length);
      for (let i = 0; i < this.allMoves.length; i++) {
        this.allMovesDict[this.allMoves[i]] = i;
        this.allMovesDictReversed[i] = this.allMoves[i];
      }
    }

    if (!this.modelBuffer || this.modelUrl !== modelUrl) {
      const res = await fetch(modelUrl);
      if (!res.ok) throw new Error(`failed to fetch model: ${res.status}`);
      this.modelBuffer = await res.arrayBuffer();
      this.modelUrl = modelUrl;
    }

    await this._createSession({ threads, simd });
  }

  async _createSession({ threads, simd }) {
    if (this.session) {
      try { await this.session.release(); } catch {}
      this.session = null;
    }

    const t0 = performance.now();
    ort.env.wasm.numThreads = Math.max(1, threads | 0);
    ort.env.wasm.simd = !!simd;
    this.threads = ort.env.wasm.numThreads;
    this.simd = ort.env.wasm.simd;

    this.session = await ort.InferenceSession.create(this.modelBuffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      // intraOpNumThreads / interOpNumThreads default to numThreads on wasm EP.
    });
    this.lastLoadMs = performance.now() - t0;
  }

  async setThreads(n) {
    if (!this.modelBuffer) throw new Error("call load() first");
    if ((n | 0) === this.threads) return;
    await this._createSession({ threads: n, simd: this.simd });
  }

  async predict({ fen, eloSelf, eloOppo }) {
    if (!this.session) throw new Error("engine not loaded");
    const t0 = performance.now();

    // Side-to-move handling. Maia 2 always operates from white's POV: if it's
    // black to move, we mirror the board, run inference, then mirror the moves
    // back when reporting them.
    const rawBoard = new Chess(fen);
    const sideToMove = rawBoard.turn(); // "w" | "b"
    const isBlackToMove = sideToMove === "b";
    const board = isBlackToMove ? mirroredBoard(rawBoard) : rawBoard;

    const boardTensor = boardToTensor(board);
    const legalMask = legalMovesMask(board, this.allMovesDict);

    const boards = new ort.Tensor("float32", boardTensor, [1, NUM_CHANNELS, 8, 8]);
    const elosSelf = new ort.Tensor("int64",
      BigInt64Array.from([BigInt(eloBucketIndex(eloSelf))]), [1]);
    const elosOppo = new ort.Tensor("int64",
      BigInt64Array.from([BigInt(eloBucketIndex(eloOppo))]), [1]);

    const outputs = await this.session.run({
      boards, elos_self: elosSelf, elos_oppo: elosOppo,
    });

    const logitsMaia = outputs.logits_maia.data;     // Float32Array(1880)
    const logitsValue = outputs.logits_value.data;   // Float32Array(1) (or scalar)

    // Mask illegal moves to logit 0 (matches maia2/inference.py).
    const masked = new Float32Array(logitsMaia.length);
    for (let i = 0; i < logitsMaia.length; i++) {
      masked[i] = logitsMaia[i] * legalMask[i];
    }
    // Softmax over the full vector.
    let maxV = -Infinity;
    for (let i = 0; i < masked.length; i++) if (masked[i] > maxV) maxV = masked[i];
    let sum = 0;
    const probs = new Float32Array(masked.length);
    for (let i = 0; i < masked.length; i++) {
      probs[i] = Math.exp(masked[i] - maxV);
      sum += probs[i];
    }
    for (let i = 0; i < probs.length; i++) probs[i] /= sum;

    // Collect legal moves only.
    const moves = [];
    for (let i = 0; i < legalMask.length; i++) {
      if (legalMask[i] === 0) continue;
      let uci = this.allMovesDictReversed[i];
      if (isBlackToMove) uci = mirrorMove(uci);
      moves.push({ uci, prob: probs[i] });
    }
    moves.sort((a, b) => b.prob - a.prob);

    let winProb = Math.max(0, Math.min(1, logitsValue[0] / 2 + 0.5));
    if (isBlackToMove) winProb = 1 - winProb;

    return {
      moves,
      winProb,
      elapsedMs: performance.now() - t0,
      threads: this.threads,
    };
  }
}
