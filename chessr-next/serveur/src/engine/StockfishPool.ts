/**
 * StockfishPool - Manages Stockfish engine instances for move analysis
 * Completely separate from Komodo pool (suggestions)
 */

import { EngineManager } from './EngineManager.js';

type ResolveCallback = (engine: EngineManager | null) => void;

export class StockfishPool {
  private maxInstances: number;
  private engines: EngineManager[] = [];
  private waitingQueue: ResolveCallback[] = [];

  constructor(maxInstances: number = 1) {
    this.maxInstances = maxInstances;
  }

  /**
   * Initialize the pool with Stockfish instances
   */
  async init(): Promise<void> {
    console.log(`[StockfishPool] Initializing ${this.maxInstances} Stockfish instances...`);

    const startPromises: Promise<void>[] = [];
    for (let i = 0; i < this.maxInstances; i++) {
      const engine = new EngineManager(i, 'stockfish');
      this.engines.push(engine);
      startPromises.push(engine.start());
    }

    await Promise.all(startPromises);
    console.log(`[StockfishPool] Initialized ${this.maxInstances} Stockfish instances`);
  }

  /**
   * Acquire an available engine
   */
  acquire(): Promise<EngineManager | null> {
    return new Promise((resolve) => {
      const available = this.engines.find((e) => e.isReady && !e.isBusy);

      if (available) {
        available.isBusy = true;
        resolve(available);
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  /**
   * Release an engine back to the pool
   */
  release(engine: EngineManager): void {
    engine.isBusy = false;

    if (this.waitingQueue.length > 0) {
      const nextRequest = this.waitingQueue.shift();
      if (nextRequest) {
        engine.isBusy = true;
        nextRequest(engine);
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; available: number; busy: number; waiting: number } {
    const available = this.engines.filter((e) => e.isReady && !e.isBusy).length;
    const busy = this.engines.filter((e) => e.isBusy).length;
    const waiting = this.waitingQueue.length;

    return { total: this.maxInstances, available, busy, waiting };
  }

  /**
   * Shutdown all engines
   */
  async shutdown(): Promise<void> {
    console.log('[StockfishPool] Shutting down all Stockfish engines...');

    for (const resolve of this.waitingQueue) {
      resolve(null);
    }
    this.waitingQueue = [];

    for (const engine of this.engines) {
      engine.stop();
    }
    this.engines = [];

    console.log('[StockfishPool] All Stockfish engines stopped');
  }
}
