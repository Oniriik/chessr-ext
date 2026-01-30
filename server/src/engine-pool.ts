import { ChessEngine, EngineOptions } from './engine.js';
import { poolLogger } from './logger.js';

interface PoolConfig {
  minEngines: number;
  maxEngines: number;
  scaleUpThreshold: number;   // Number of waiting requests to trigger scale up
  scaleDownIdleTime: number;  // Ms of idle time before scale down
  engineOptions: EngineOptions;
}

export class EnginePool {
  private pool: ChessEngine[] = [];
  private available: ChessEngine[] = [];
  private config: PoolConfig;
  private initialized = false;
  private lastActivityTime = Date.now();
  private scaleDownTimer: NodeJS.Timeout | null = null;
  private pendingEngines = 0; // Track engines being created to prevent race conditions
  private isScalingDown = false; // Guard against concurrent scale-down operations
  private isScalingUp = false; // Guard against concurrent scale-up operations
  private waitingDirectRequests = 0; // Track direct requests waiting for engines
  private engineLastUsed: Map<ChessEngine, number> = new Map(); // Track last use time per engine

  constructor(config: Partial<PoolConfig> = {}) {
    this.config = {
      minEngines: config.minEngines ?? 1,  // Reduced from 2 to 1
      maxEngines: config.maxEngines ?? 4,  // Reduced from 8 to 4
      scaleUpThreshold: config.scaleUpThreshold ?? 2,
      scaleDownIdleTime: config.scaleDownIdleTime ?? 60000, // 1 minute
      engineOptions: { threads: 2, hash: 64, ...config.engineOptions },
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    poolLogger.log('init', 0, 0, {
      min: this.config.minEngines,
      max: this.config.maxEngines,
      idleTimeMs: this.config.scaleDownIdleTime
    });

    // Start with minimum engines
    for (let i = 0; i < this.config.minEngines; i++) {
      await this.addEngine();
    }

    this.initialized = true;
    this.startScaleDownMonitor();

    poolLogger.log('ready', this.pool.length, this.available.length);
  }

  private async addEngine(silent = false): Promise<ChessEngine | null> {
    // Check both actual pool size AND pending engines to prevent race condition
    if (this.pool.length + this.pendingEngines >= this.config.maxEngines) {
      return null;
    }

    this.pendingEngines++;

    try {
      const engine = new ChessEngine();
      await engine.init(this.config.engineOptions);
      this.pool.push(engine);
      this.available.push(engine);
      this.engineLastUsed.set(engine, Date.now()); // Track when engine was added

      if (!silent) {
        poolLogger.log('add', this.pool.length, this.available.length, { max: this.config.maxEngines });
      }
      return engine;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      poolLogger.log('error', this.pool.length, this.available.length, { action: 'add', error: errorMsg });
      return null;
    } finally {
      this.pendingEngines--;
    }
  }

  private async removeEngine(): Promise<void> {
    if (this.pool.length <= this.config.minEngines) {
      return;
    }

    // Only remove idle engines
    const engine = this.available.pop();
    if (engine) {
      const index = this.pool.indexOf(engine);
      if (index !== -1) {
        this.pool.splice(index, 1);
        engine.quit();
        poolLogger.log('remove', this.pool.length, this.available.length, { max: this.config.maxEngines });
      }
    }
  }

  /**
   * Proactive healthcheck: purge dead engines from pool even without traffic.
   * This prevents dead engines from blocking scale-down detection.
   */
  private purgeDeadEngines(): void {
    // Snapshot to avoid mutating while iterating
    const snapshot = [...this.available];
    for (const engine of snapshot) {
      if (!engine.isAlive()) {
        poolLogger.log('dead', this.pool.length, this.available.length, { action: 'purge' });
        this.removeDeadEngine(engine);
      }
    }
  }

  /**
   * Try to scale up - takes lock synchronously to prevent cascade
   */
  private tryScaleUp(): void {
    // 1) Already scaling up => skip
    if (this.isScalingUp) return;

    // 2) Engine creation in progress => skip
    if (this.pendingEngines > 0) return;

    // 3) Already at max => skip
    if (this.pool.length >= this.config.maxEngines) return;

    // 4) Check if we need scale-up (direct requests waiting)
    if (this.waitingDirectRequests < this.config.scaleUpThreshold) return;

    // 5) At least one healthy engine available => skip
    if (this.available.some(e => e.isAlive())) return;

    // TAKE LOCK SYNCHRONOUSLY (critical to avoid race condition)
    this.isScalingUp = true;

    // Launch async scale-up (lock already taken)
    this.scaleUpLocked().catch(err => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      poolLogger.log('error', this.pool.length, this.available.length, { action: 'scale_up', error: errorMsg });
    });
  }

  /**
   * Actually perform scale-up - lock must be taken before calling
   */
  private async scaleUpLocked(): Promise<void> {
    try {
      if (this.pool.length >= this.config.maxEngines) return;

      const engine = await this.addEngine(true); // Silent mode - don't log [add]

      if (engine) {
        poolLogger.log('scale_up', this.pool.length, this.available.length, { poolSize: this.pool.length });
      }
    } finally {
      this.isScalingUp = false;

      // Progressive scale-up: if still saturated and no healthy engine available
      if (
        this.waitingDirectRequests >= this.config.scaleUpThreshold &&
        !this.available.some(e => e.isAlive())
      ) {
        this.tryScaleUp();
      }
    }
  }

  private startScaleDownMonitor(): void {
    this.scaleDownTimer = setInterval(async () => {
      // Guard against concurrent scale-down operations
      if (this.isScalingDown) return;

      // 1) Purge dead engines first (mini healthcheck)
      this.purgeDeadEngines();

      // 2) Check if we can scale down (more engines than minimum)
      if (this.pool.length <= this.config.minEngines) return;

      // 3) Find idle engines (available and not used recently)
      const now = Date.now();
      const idleEngines: ChessEngine[] = [];

      for (const engine of this.available) {
        if (!engine.isAlive()) continue;

        const lastUsed = this.engineLastUsed.get(engine) || 0;
        const engineIdleTime = now - lastUsed;

        if (engineIdleTime > this.config.scaleDownIdleTime) {
          idleEngines.push(engine);
        }
      }

      // 4) Remove idle engines one at a time (respecting minEngines)
      if (idleEngines.length > 0) {
        this.isScalingDown = true;
        try {
          for (const engine of idleEngines) {
            // Stop if we've reached minimum
            if (this.pool.length <= this.config.minEngines) break;

            // Get idle time before deletion for logging
            const lastUsed = this.engineLastUsed.get(engine) || 0;
            const engineIdleTime = now - lastUsed;

            // Remove this specific engine
            const availableIdx = this.available.indexOf(engine);
            if (availableIdx !== -1) {
              this.available.splice(availableIdx, 1);
            }

            const poolIdx = this.pool.indexOf(engine);
            if (poolIdx !== -1) {
              this.pool.splice(poolIdx, 1);
              this.engineLastUsed.delete(engine);
              engine.quit();
              poolLogger.log('remove', this.pool.length, this.available.length, { reason: 'idle', idleMs: engineIdleTime });
            }
          }
        } finally {
          this.isScalingDown = false;
        }
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Remove a dead engine from the pool entirely
   */
  private removeDeadEngine(engine: ChessEngine): void {
    const poolIndex = this.pool.indexOf(engine);
    if (poolIndex !== -1) {
      this.pool.splice(poolIndex, 1);
    }

    const availIndex = this.available.indexOf(engine);
    if (availIndex !== -1) {
      this.available.splice(availIndex, 1);
    }

    try {
      engine.quit();
    } catch {
      // Ignore quit errors on dead engine
    }

    poolLogger.log('dead', this.pool.length, this.available.length, { action: 'removed' });

    // Ensure minimum engines (async, don't wait)
    if (this.pool.length < this.config.minEngines) {
      this.addEngine().catch(() => {
        poolLogger.log('error', this.pool.length, this.available.length, { action: 'add_min', error: 'Failed to maintain minimum engines' });
      });
    }
  }

  /**
   * Get engine for direct UCI control (bypasses CandidateSelector).
   * Blocks until engine available.
   * Used by the new analysis pipeline.
   */
  async getEngineForDirectUse(): Promise<ChessEngine> {
    if (!this.initialized) {
      throw new Error('Pool not initialized');
    }

    this.lastActivityTime = Date.now();

    while (true) {
      // Try to get available engine
      const engine = this.available.shift();
      if (engine && engine.isAlive()) {
        poolLogger.log('acquire', this.pool.length, this.available.length);
        return engine;
      }

      // Dead engine found, remove it
      if (engine && !engine.isAlive()) {
        poolLogger.log('dead', this.pool.length, this.available.length, { action: 'direct_use' });
        this.removeDeadEngine(engine);
      }

      // No engine available, mark as waiting and try to scale up
      this.waitingDirectRequests++;
      this.tryScaleUp();

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 50));

      // Decrement before next iteration (either we get an engine or loop again)
      this.waitingDirectRequests--;
    }
  }

  /**
   * Release engine back to pool after direct use.
   * Checks if engine is still alive before returning to pool.
   */
  releaseEngine(engine: ChessEngine): void {
    this.lastActivityTime = Date.now();
    this.engineLastUsed.set(engine, Date.now()); // Update last used time

    if (engine.isAlive()) {
      // Return to available pool
      if (!this.available.includes(engine)) {
        this.available.push(engine);
        poolLogger.log('release', this.pool.length, this.available.length);
      }
    } else {
      // Engine died during use, remove from pool
      poolLogger.log('dead', this.pool.length, this.available.length, { action: 'release' });
      this.removeDeadEngine(engine);
    }
  }

  // Metrics methods
  getPoolSize(): number {
    return this.pool.length;
  }

  getAvailableCount(): number {
    return this.available.length;
  }

  getQueueLength(): number {
    return this.waitingDirectRequests;
  }
}
