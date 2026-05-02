/**
 * TorchClassifier — given a TorchAnalysisEngine instance and a base
 * history, classify a single candidate move via fetch_analysis.
 *
 * Cache keyed on `<historyHash>|<candidateUci>`. Sequential queue:
 * torch is single-threaded and the live engine may be mid-call, so
 * stacked classifier requests resolve one after the other rather than
 * racing against live moves.
 *
 * Used by TorchSuggestionEngine to label each top-N PV with its native
 * Chess.com class.
 */

import type { TorchAnalysisEngine } from './torchAnalysisEngine.js';
import type { MoveClassification } from './torchClassification.js';

export class TorchClassifier {
  private engine: TorchAnalysisEngine;
  private cache = new Map<string, MoveClassification>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(engine: TorchAnalysisEngine) {
    this.engine = engine;
  }

  async classify(history: string[], candidateUci: string): Promise<MoveClassification> {
    const key = history.join(' ') + '|' + candidateUci;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const promise = this.queue.then(async () => {
      try {
        const a = await this.engine.fetchFullAnalysis([...history, candidateUci]);
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
