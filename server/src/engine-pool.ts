import { ChessEngine, EngineOptions, Personality } from './engine.js';
import { AnalysisResult, InfoUpdate } from './types.js';
import { CandidateSelector } from './candidate-selector.js';
import { poolLogger } from './logger.js';

interface AnalysisRequest {
  id: string;  // Unique request ID for log correlation
  clientRequestId?: string;  // Optional request ID from client to match request/response
  fen: string;
  options: {
    moves: string[];
    elo: number;
    personality: Personality;
    playerColor: 'w' | 'b';
    allowBrilliant: boolean;
    showAlwaysBestMoveFirst: boolean;
  };
  createdAt: number;  // Timestamp for queue wait time tracking
  resolve: (result: AnalysisResult) => void;
  reject: (error: Error) => void;
}

// Simple incrementing request ID
let requestCounter = 0;
function nextRequestId(): string {
  return `r${++requestCounter}`;
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
  private isScalingDown = false; // Guard against concurrent scale-down operations
  private isScalingUp = false; // Guard against concurrent scale-up operations

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

    poolLogger.log('init', 0, 0, { min: this.config.minEngines, max: this.config.maxEngines });

    // Start with minimum engines
    for (let i = 0; i < this.config.minEngines; i++) {
      await this.addEngine();
    }

    this.initialized = true;
    this.startScaleDownMonitor();

    poolLogger.log('ready', this.pool.length, this.available.length);
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
      poolLogger.log('add', this.pool.length, this.available.length, { max: this.config.maxEngines });
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

    // 4) Queue no longer needs scale-up (was drained in the meantime)
    if (this.queue.length < this.config.scaleUpThreshold) return;

    // 5) At least one healthy engine available => skip
    if (this.available.some(e => e.isAlive())) return;

    // TAKE LOCK SYNCHRONOUSLY (critical to avoid race condition)
    this.isScalingUp = true;

    poolLogger.log('scale_up', this.pool.length, this.available.length, { qLen: this.queue.length });

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

      const engine = await this.addEngine();

      // If we added an engine and there's a queued request, process it
      if (engine && this.queue.length > 0) {
        const request = this.queue.shift()!;
        this.processRequest(engine, request);
        // Remove from available since we're using it
        const idx = this.available.indexOf(engine);
        if (idx !== -1) this.available.splice(idx, 1);
      }
    } finally {
      this.isScalingUp = false;

      // Progressive scale-up: if still saturated and no healthy engine available
      if (
        this.queue.length >= this.config.scaleUpThreshold &&
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

      // 2) Calculate conditions
      const idleTime = Date.now() - this.lastActivityTime;
      const hasExtraEngines = this.pool.length > this.config.minEngines;
      // Robust check: all engines must be in available AND alive
      const allIdle =
        this.pool.length > 0 &&
        this.pool.every(e => this.available.includes(e) && e.isAlive());

      // 3) Debug log only when close to triggering (idle > 50% of threshold)
      if (hasExtraEngines && idleTime > this.config.scaleDownIdleTime * 0.5) {
        poolLogger.log('scale_down', this.pool.length, this.available.length, { status: 'check', idleMs: idleTime, allIdle });
      }

      // 4) Scale down if conditions met
      if (hasExtraEngines && allIdle && idleTime > this.config.scaleDownIdleTime) {
        this.isScalingDown = true;
        try {
          const enginesToRemove = this.pool.length - this.config.minEngines;
          poolLogger.log('scale_down', this.pool.length, this.available.length, { status: 'trigger', removing: enginesToRemove });
          // Sequential removal to avoid race conditions
          for (let i = 0; i < enginesToRemove; i++) {
            await this.removeEngine();
          }
        } finally {
          this.isScalingDown = false;
        }
      }
    }, 5000); // Check every 5 seconds
  }

  async analyze(
    fen: string,
    options: {
      moves: string[];
      elo: number;
      personality?: Personality;
      playerColor: 'w' | 'b';
      allowBrilliant?: boolean;
      showAlwaysBestMoveFirst?: boolean;
      clientRequestId?: string;  // Optional request ID from client
    }
  ): Promise<AnalysisResult> {
    if (!this.initialized) {
      throw new Error('Pool not initialized');
    }

    this.lastActivityTime = Date.now();

    return new Promise((resolve, reject) => {
      const request: AnalysisRequest = {
        id: nextRequestId(),
        clientRequestId: options.clientRequestId,
        fen,
        options: {
          moves: options.moves,
          elo: options.elo,
          personality: options.personality || 'Default',
          playerColor: options.playerColor,
          allowBrilliant: options.allowBrilliant ?? false,
          showAlwaysBestMoveFirst: options.showAlwaysBestMoveFirst ?? false,
        },
        createdAt: Date.now(),
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
          this.tryScaleUp();
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
          poolLogger.log('restart', this.pool.length, this.available.length, { req: request.id, status: 'cooldown', waitMs: 5000 - (now - lastRestart) });
          this.removeDeadEngine(engine);
          request.reject(new Error('Engine unavailable, please retry'));
          return;
        }

        poolLogger.log('restart', this.pool.length, this.available.length, { req: request.id, reason: 'dead' });
        this.restartCooldowns.set(engine, now);
        await engine.restart();
      }

      // Use CandidateSelector for ELO-tuned 3-move selection
      const selector = new CandidateSelector(engine);
      const selectResult = await selector.selectMoves(
        request.fen,
        request.options.moves,
        request.options.elo,
        request.options.playerColor,
        request.options.allowBrilliant,
        request.options.showAlwaysBestMoveFirst,
        request.id
      );

      // Build AnalysisResult from CandidateSelector result
      const result: AnalysisResult = {
        type: 'result',
        requestId: request.clientRequestId || request.id,  // Use client ID if provided, otherwise internal ID
        bestMove: selectResult.bestMove,
        evaluation: selectResult.evaluation,
        lines: selectResult.lines,
        depth: 0, // Not applicable with node-based search
        timing: selectResult.timing,
        playerPerformance: selectResult.playerPerformance ? {
          acpl: 0, // Not calculated in warmup
          estimatedElo: 0, // Not calculated in warmup
          accuracy: selectResult.playerPerformance.accuracy,
          movesAnalyzed: selectResult.playerPerformance.movesAnalyzed,
        } : undefined,
      };

      // Clear cooldown on success
      this.restartCooldowns.delete(engine);
      request.resolve(result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      poolLogger.log('error', this.pool.length, this.available.length, { req: request.id, retry: retryCount, error: errorMsg });

      // Only retry once
      if (retryCount < MAX_RETRIES) {
        try {
          this.restartCooldowns.set(engine, Date.now());
          await engine.restart();
          poolLogger.log('restart', this.pool.length, this.available.length, { req: request.id, reason: 'error', status: 'ok' });

          // Retry the request with the restarted engine
          return this.processRequest(engine, request, retryCount + 1);
        } catch (restartErr) {
          const restartErrMsg = restartErr instanceof Error ? restartErr.message : String(restartErr);
          poolLogger.log('error', this.pool.length, this.available.length, { req: request.id, action: 'restart', error: restartErrMsg });
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

    poolLogger.log('dead', this.pool.length, this.available.length, { action: 'removed' });

    // Ensure minimum engines (async, don't wait)
    if (this.pool.length < this.config.minEngines) {
      this.addEngine().catch(() => {
        poolLogger.log('error', this.pool.length, this.available.length, { action: 'add_min', error: 'Failed to maintain minimum engines' });
      });
    }
  }

  private returnEngine(engine: ChessEngine): void {
    // Only return healthy engines to the pool
    if (!engine.isAlive()) {
      poolLogger.log('dead', this.pool.length, this.available.length, { action: 'discard' });
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

      // No engine available, try to scale up
      this.tryScaleUp();

      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Release engine back to pool after direct use.
   * Checks if engine is still alive before returning to pool.
   */
  releaseEngine(engine: ChessEngine): void {
    this.lastActivityTime = Date.now();

    if (engine.isAlive()) {
      // Check if there's a queued request that needs this engine
      const nextRequest = this.queue.shift();
      if (nextRequest) {
        this.processRequest(engine, nextRequest);
      } else {
        // Return to available pool
        if (!this.available.includes(engine)) {
          this.available.push(engine);
          poolLogger.log('release', this.pool.length, this.available.length);
        }
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
    return this.queue.length;
  }
}
