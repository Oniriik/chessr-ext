import { ChessEngine, EngineOptions, Personality } from './engine.js';
import { AnalysisResult, InfoUpdate } from './types.js';
import { globalLogger } from './logger.js';

interface AnalysisRequest {
  fen: string;
  options: {
    moves: string[];
    searchMode: 'depth' | 'time';
    depth: number;
    moveTime: number;
    multiPV: number;
    elo: number;
    personality: Personality;
  };
  onInfo?: (info: InfoUpdate) => void;
  resolve: (result: AnalysisResult) => void;
  reject: (error: Error) => void;
}

interface PoolConfig {
  minEngines: number;
  maxEngines: number;
  scaleUpThreshold: number;   // Queue size to trigger scale up
  scaleDownIdleTime: number;  // Ms of idle time before scale down
  engineOptions: EngineOptions;
}

export class EnginePool {
  private pool: ChessEngine[] = [];
  private available: ChessEngine[] = [];
  private queue: AnalysisRequest[] = [];
  private config: PoolConfig;
  private initialized = false;
  private lastActivityTime = Date.now();
  private scaleDownTimer: NodeJS.Timeout | null = null;
  private restartCooldowns: Map<ChessEngine, number> = new Map(); // Track restart attempts
  private pendingEngines = 0; // Track engines being created to prevent race conditions

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

    globalLogger.info('pool_init', { min: this.config.minEngines, max: this.config.maxEngines });

    // Start with minimum engines
    for (let i = 0; i < this.config.minEngines; i++) {
      await this.addEngine();
    }

    this.initialized = true;
    this.startScaleDownMonitor();

    globalLogger.info('pool_ready', { engines: this.pool.length });
  }

  private async addEngine(): Promise<ChessEngine | null> {
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
      globalLogger.info('pool_engine_added', { current: this.pool.length, max: this.config.maxEngines });
      return engine;
    } catch (err) {
      globalLogger.error('pool_engine_error', err instanceof Error ? err : String(err), { action: 'add' });
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
        globalLogger.info('pool_engine_removed', { current: this.pool.length, max: this.config.maxEngines });
      }
    }
  }

  private async scaleUp(): Promise<void> {
    if (this.pool.length >= this.config.maxEngines) {
      return;
    }

    const engine = await this.addEngine();

    // If we added an engine and there's a queued request, process it
    if (engine && this.queue.length > 0) {
      const request = this.queue.shift()!;
      this.processRequest(engine, request);
      // Remove from available since we're using it
      const idx = this.available.indexOf(engine);
      if (idx !== -1) this.available.splice(idx, 1);
    }
  }

  private startScaleDownMonitor(): void {
    this.scaleDownTimer = setInterval(() => {
      const idleTime = Date.now() - this.lastActivityTime;
      const hasExtraEngines = this.pool.length > this.config.minEngines;
      const allIdle = this.available.length === this.pool.length;

      if (hasExtraEngines && allIdle && idleTime > this.config.scaleDownIdleTime) {
        // Remove all extra engines at once when idle
        const enginesToRemove = this.pool.length - this.config.minEngines;
        for (let i = 0; i < enginesToRemove; i++) {
          this.removeEngine();
        }
      }
    }, 5000); // Check every 5 seconds
  }

  async analyze(
    fen: string,
    options: {
      moves: string[];
      searchMode?: 'depth' | 'time';
      depth: number;
      moveTime?: number;
      multiPV: number;
      elo: number;
      personality?: Personality;
    },
    onInfo?: (info: InfoUpdate) => void
  ): Promise<AnalysisResult> {
    if (!this.initialized) {
      throw new Error('Pool not initialized');
    }

    this.lastActivityTime = Date.now();

    return new Promise((resolve, reject) => {
      const request: AnalysisRequest = {
        fen,
        options: {
          moves: options.moves,
          searchMode: options.searchMode || 'depth',
          depth: options.depth,
          moveTime: options.moveTime || 1000,
          multiPV: options.multiPV,
          elo: options.elo,
          personality: options.personality || 'Default',
        },
        onInfo,
        resolve,
        reject,
      };

      // Try to get an available engine immediately
      // Prefer healthy engines
      let engine: ChessEngine | undefined;
      while (this.available.length > 0) {
        engine = this.available.pop();
        if (engine && engine.isAlive()) {
          break;
        }
        // Dead engine, will be restarted in processRequest
        if (engine) break;
      }

      if (engine) {
        this.processRequest(engine, request);
      } else {
        // No engine available, add to queue
        this.queue.push(request);

        // Scale up if queue is getting long
        if (this.queue.length >= this.config.scaleUpThreshold) {
          this.scaleUp();
        }
      }
    });
  }

  private async processRequest(engine: ChessEngine, request: AnalysisRequest, retryCount = 0): Promise<void> {
    const MAX_RETRIES = 1; // Only retry once
    this.lastActivityTime = Date.now();

    try {
      // Check if engine is still alive before using it
      if (!engine.isAlive()) {
        // Check cooldown to prevent rapid restart loops
        const lastRestart = this.restartCooldowns.get(engine) || 0;
        const now = Date.now();
        if (now - lastRestart < 5000) {
          // Too soon to restart, reject and remove engine
          globalLogger.info('pool_engine_cooldown', { waitMs: 5000 - (now - lastRestart) });
          this.removeDeadEngine(engine);
          request.reject(new Error('Engine unavailable, please retry'));
          return;
        }

        globalLogger.info('pool_engine_restart', { reason: 'dead_before_use' });
        this.restartCooldowns.set(engine, now);
        await engine.restart();
      }

      engine.setElo(request.options.elo);
      engine.setPersonality(request.options.personality);

      const result = await engine.analyze(
        request.fen,
        {
          moves: request.options.moves,
          searchMode: request.options.searchMode,
          depth: request.options.depth,
          moveTime: request.options.moveTime,
          multiPV: request.options.multiPV,
        },
        request.onInfo
      );

      // Clear cooldown on success
      this.restartCooldowns.delete(engine);
      request.resolve(result);
    } catch (err) {
      globalLogger.error('pool_engine_error', err instanceof Error ? err : String(err), { action: 'analyze', retryCount });

      // Only retry once
      if (retryCount < MAX_RETRIES) {
        try {
          this.restartCooldowns.set(engine, Date.now());
          await engine.restart();
          globalLogger.info('pool_engine_restart', { reason: 'error_recovery', status: 'success' });

          // Retry the request with the restarted engine
          return this.processRequest(engine, request, retryCount + 1);
        } catch (restartErr) {
          globalLogger.error('pool_engine_error', restartErr instanceof Error ? restartErr : String(restartErr), { action: 'restart_failed' });
        }
      }

      // Failed after retries - remove dead engine and reject
      this.removeDeadEngine(engine);
      request.reject(err instanceof Error ? err : new Error('Analysis failed'));
      return;
    }

    // Return engine to pool and process next request
    this.returnEngine(engine);
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

    this.restartCooldowns.delete(engine);

    try {
      engine.quit();
    } catch {
      // Ignore quit errors on dead engine
    }

    globalLogger.info('pool_engine_removed', { reason: 'dead', current: this.pool.length });

    // Ensure minimum engines (async, don't wait)
    if (this.pool.length < this.config.minEngines) {
      this.addEngine().catch(() => {
        globalLogger.error('pool_engine_error', 'Failed to maintain minimum engines', { action: 'add_minimum' });
      });
    }
  }

  private returnEngine(engine: ChessEngine): void {
    // Only return healthy engines to the pool
    if (!engine.isAlive()) {
      globalLogger.info('pool_engine_dead', { action: 'discarding' });
      this.removeDeadEngine(engine);
      return;
    }

    // Check if there's a pending request
    const nextRequest = this.queue.shift();
    if (nextRequest) {
      this.processRequest(engine, nextRequest);
    } else {
      // Only add to available if not already there
      if (!this.available.includes(engine)) {
        this.available.push(engine);
      }
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
    return this.queue.length;
  }
}
