/**
 * EnginePool - Manages multiple Komodo Dragon engine instances
 * Provides load balancing and request queuing
 */

import { EngineManager } from './EngineManager.js';

type ResolveCallback = (engine: EngineManager | null) => void;

export class EnginePool {
  private maxInstances: number;
  private engines: EngineManager[] = [];
  private waitingQueue: ResolveCallback[] = [];

  constructor(maxInstances: number = 2) {
    this.maxInstances = maxInstances;
  }

  /**
   * Initialize the pool with engine instances
   */
  async init(): Promise<void> {
    console.log(`[EnginePool] Initializing ${this.maxInstances} Komodo Dragon instances...`);

    const startPromises: Promise<void>[] = [];
    for (let i = 0; i < this.maxInstances; i++) {
      const engine = new EngineManager(i);
      this.engines.push(engine);
      startPromises.push(engine.start());
    }

    await Promise.all(startPromises);
    console.log(`[EnginePool] Initialized ${this.maxInstances} Komodo Dragon instances`);
  }

  /**
   * Acquire an available engine
   * If none available, waits until one is released
   */
  acquire(): Promise<EngineManager | null> {
    return new Promise((resolve) => {
      // Find an available engine
      const available = this.engines.find((e) => e.isReady && !e.isBusy);

      if (available) {
        available.isBusy = true;
        resolve(available);
      } else {
        // Queue the request
        this.waitingQueue.push(resolve);
      }
    });
  }

  /**
   * Release an engine back to the pool
   */
  release(engine: EngineManager): void {
    engine.isBusy = false;

    // If there's a waiting request, give the engine to it
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
    console.log('[EnginePool] Shutting down all engines...');

    // Reject any waiting requests
    for (const resolve of this.waitingQueue) {
      resolve(null);
    }
    this.waitingQueue = [];

    // Stop all engines
    for (const engine of this.engines) {
      engine.stop();
    }
    this.engines = [];

    console.log('[EnginePool] All engines stopped');
  }
}
