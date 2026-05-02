/**
 * TorchClassifier — classify a single candidate move via the live torch
 * fetch_analysis engine. Reads the live engine LAZILY through a getter so
 * that if the live engine is replaced (e.g. crash recovery), subsequent
 * classify() calls pick up the new instance instead of holding a stale
 * reference.
 *
 * Cache keyed on `<historyHash>|<candidateUci>`. Sequential queue: torch
 * is single-threaded; stacked classifier requests resolve one after the
 * other.
 */

import type { TorchAnalysisEngine } from './torchAnalysisEngine.js';
import type { MoveClassification } from './torchClassification.js';

export class TorchClassifier {
  /** Lazy getter: read the current live torch engine on every call. The
   *  reference can change if buildLiveAnalysis re-inits after a crash. */
  private getEngine: () => TorchAnalysisEngine | null;
  private cache = new Map<string, MoveClassification>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(getEngine: () => TorchAnalysisEngine | null) {
    this.getEngine = getEngine;
  }

  async classify(history: string[], candidateUci: string): Promise<MoveClassification> {
    const key = history.join(' ') + '|' + candidateUci;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const promise = this.queue.then(async () => {
      const engine = this.getEngine();
      if (!engine?.ready) return 'good' as MoveClassification;
      try {
        const a = await engine.fetchFullAnalysis([...history, candidateUci]);
        const last = a.moveAnalyses[a.moveAnalyses.length - 1];
        const klass: MoveClassification = last?.classification ?? 'good';
        this.cache.set(key, klass);
        return klass;
      } catch {
        // Swallow per-candidate failures; the suggestion still renders
        // without a class badge. Fall back to 'good' as a neutral marker.
        return 'good' as MoveClassification;
      }
    });
    this.queue = promise;
    return promise;
  }

  clear() { this.cache.clear(); }
}
