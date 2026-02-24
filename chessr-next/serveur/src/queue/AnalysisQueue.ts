/**
 * AnalysisQueue - Request queue for move analysis
 * Same superseding logic as SuggestionQueue
 */

import type { EngineManager } from '../engine/EngineManager.js';

export type MoveClassification =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export type GamePhase = 'opening' | 'middlegame' | 'endgame';

export interface AnalysisResult {
  move: string;
  classification: MoveClassification;
  cpl: number;
  accuracyImpact: number;
  weightedImpact: number;
  phase: GamePhase;
  evalBefore: number;
  evalAfter: number;
  bestMove: string;
}

export interface AnalysisRequest {
  requestId: string;
  userId: string;
  process: (engine: EngineManager) => Promise<AnalysisResult>;
  callback: (error: Error | null, result?: AnalysisResult) => void;
}

export class AnalysisQueue {
  private queue: AnalysisRequest[] = [];
  private processing: Set<string> = new Set();

  /**
   * Add a request to the queue
   * Removes any existing pending request from the same user
   */
  enqueue(request: AnalysisRequest): void {
    this.queue = this.queue.filter((r) => r.userId !== request.userId);
    this.queue.push(request);
  }

  /**
   * Get the next request to process
   */
  dequeue(): AnalysisRequest | null {
    if (this.queue.length === 0) {
      return null;
    }

    const index = this.queue.findIndex((r) => !this.processing.has(r.userId));

    if (index === -1) {
      return this.queue.shift() || null;
    }

    const [request] = this.queue.splice(index, 1);
    return request;
  }

  markProcessing(userId: string): void {
    this.processing.add(userId);
  }

  markDone(userId: string): void {
    this.processing.delete(userId);
  }

  isRequestValid(requestId: string, userId: string): boolean {
    const newerRequest = this.queue.find((r) => r.userId === userId);
    return !newerRequest || newerRequest.requestId === requestId;
  }

  cancelForUser(userId: string): void {
    this.queue = this.queue.filter((r) => r.userId !== userId);
  }

  getStats(): { pending: number; processing: number } {
    return {
      pending: this.queue.length,
      processing: this.processing.size,
    };
  }

  get length(): number {
    return this.queue.length;
  }
}
