/**
 * Module-scope holder for the active TorchAnalysisEngine instance.
 *
 * Why a separate module: TorchSuggestionEngine wants to share the live
 * analysis engine for per-candidate classification (avoids spinning up
 * a third torch.wasm Worker = ~26 MB extra). content.tsx instantiates
 * the live engine and registers it here; TorchSuggestionEngine reads
 * via the getter. This indirection keeps the import graph acyclic
 * (content → suggestionEngine, suggestionEngine → torchLiveRef, content
 * → torchLiveRef — no cycle).
 */

import type { TorchAnalysisEngine } from './torchAnalysisEngine.js';

let liveEngine: TorchAnalysisEngine | null = null;

export function setTorchLiveEngine(engine: TorchAnalysisEngine | null): void {
  liveEngine = engine;
}

export function getTorchLiveEngine(): TorchAnalysisEngine | null {
  return liveEngine;
}
