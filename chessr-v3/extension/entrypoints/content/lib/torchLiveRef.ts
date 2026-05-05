/**
 * Module-scope holder for the active TorchAnalysisEngine instance.
 *
 * Suggestion engines (Komodo / Stockfish / Maia) call into the live
 * engine for per-candidate classification (avoids spinning up an
 * extra explanation-engine.wasm Worker = ~26 MB extra). content.tsx
 * instantiates the live engine and registers it here; consumers read
 * via the getter. The indirection keeps the import graph acyclic
 * (content → suggestionEngine, suggestionEngine → torchLiveRef,
 * content → torchLiveRef — no cycle).
 */

import type { TorchAnalysisEngine } from './torchAnalysisEngine.js';

let liveEngine: TorchAnalysisEngine | null = null;

export function setTorchLiveEngine(engine: TorchAnalysisEngine | null): void {
  liveEngine = engine;
}

export function getTorchLiveEngine(): TorchAnalysisEngine | null {
  return liveEngine;
}
