/**
 * IEngine — common interface implemented by every suggestion-producing
 * engine (Komodo Dragon, Maia 2, …). content.tsx programs against this
 * interface so swapping engines is just `disposeOld(); newEngine.init()`.
 */

import type { LabeledSuggestion } from './engineLabeler';
import type { SearchOptions } from './searchOptions';
import type { EngineCapabilities, EngineId, MaiaVariant } from '../stores/engineStore';

export interface SuggestionSearchParams {
  fen: string;
  /** Pre-played moves from the FEN (for accurate engine state). Optional. */
  moves?: string[];
  /** How many alternative moves to return (1..3). */
  multiPv: number;

  // ─── Komodo / classical-engine fields ──────────────────────────────────
  targetElo?: number;
  personality?: string;
  limitStrength?: boolean;
  dynamism?: number;
  kingSafety?: number;
  variety?: number;
  search?: SearchOptions;

  // ─── Maia 2 fields ─────────────────────────────────────────────────────
  /** Side-to-move's ELO (mapped to a Maia bucket). */
  eloSelf?: number;
  /** Opponent's ELO (mapped to a Maia bucket). */
  eloOppo?: number;
  /** Which Maia variant to use. */
  variant?: MaiaVariant;
  /** When true, prefer Polyglot opening-book moves over Maia's policy
   *  (default — covers Maia's unreliable opening phase). */
  useBook?: boolean;
}

export interface IEngine {
  readonly id: EngineId;
  readonly ready: boolean;
  init(): Promise<void>;
  search(params: SuggestionSearchParams): Promise<LabeledSuggestion[]>;
  /** Optional game-boundary signal — Maia ignores it (stateless). */
  newGame(): Promise<void>;
  /** Cancel any in-flight search. Resolves once the engine is idle again. */
  cancel(): Promise<void>;
  destroy(): void;
  /** Reported capabilities — drives which UI sections render in the panel. */
  getCapabilities(): EngineCapabilities;
}
