/**
 * SuggestionQueue - Request queue with user-based superseding
 * When a user sends a new request, their previous pending request is removed
 */

import type { EngineManager } from '../engine/EngineManager.js';
import type { LabeledSuggestion } from '../engine/MoveLabeler.js';

export interface SuggestionResult {
  fen: string;
  personality: string;
  suggestions: LabeledSuggestion[];
  positionEval: number;
  mateIn: number | null;
  winRate: number;
  puzzleMode: boolean;
}

export interface SuggestionRequest {
  requestId: string;
  userId: string;
  process: (engine: EngineManager) => Promise<SuggestionResult>;
  callback: (error: Error | null, result?: SuggestionResult) => void;
}

export class SuggestionQueue {
  private queue: SuggestionRequest[] = [];
  private processing: Set<string> = new Set();

  /**
   * Add a request to the queue
   * Removes any existing pending request from the same user
   */
  enqueue(request: SuggestionRequest): void {
    // Remove any existing pending requests from the same user
    this.queue = this.queue.filter((r) => r.userId !== request.userId);
    this.queue.push(request);
  }

  /**
   * Get the next request to process
   * Prioritizes users who don't have a request being processed
   */
  dequeue(): SuggestionRequest | null {
    if (this.queue.length === 0) {
      return null;
    }

    // Find first request from a user not currently being processed
    const index = this.queue.findIndex((r) => !this.processing.has(r.userId));

    if (index === -1) {
      // All queued users have requests being processed, return first anyway
      return this.queue.shift() || null;
    }

    // Remove and return the found request
    const [request] = this.queue.splice(index, 1);
    return request;
  }

  /**
   * Mark a user's request as being processed
   */
  markProcessing(userId: string): void {
    this.processing.add(userId);
  }

  /**
   * Mark a user's request as done processing
   */
  markDone(userId: string): void {
    this.processing.delete(userId);
  }

  /**
   * Check if a specific requestId is still valid (not superseded)
   */
  isRequestValid(requestId: string, userId: string): boolean {
    // Check if there's a newer request from this user in the queue
    const newerRequest = this.queue.find((r) => r.userId === userId);
    return !newerRequest || newerRequest.requestId === requestId;
  }

  /**
   * Cancel all pending requests for a user
   */
  cancelForUser(userId: string): void {
    this.queue = this.queue.filter((r) => r.userId !== userId);
  }

  /**
   * Get queue statistics
   */
  getStats(): { pending: number; processing: number } {
    return {
      pending: this.queue.length,
      processing: this.processing.size,
    };
  }

  /**
   * Get queue length
   */
  get length(): number {
    return this.queue.length;
  }
}
