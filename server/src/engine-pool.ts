import { ChessEngine, EngineOptions, Personality } from './engine.js';
import { AnalysisResult, InfoUpdate } from './types.js';
import { CandidateSelector } from './candidate-selector.js';
import { globalLogger } from './logger.js';

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
      globalLogger.info('pool_add', { pool: this.pool.length, max: this.config.maxEngines });
      return engine;
    } catch (err) {
      globalLogger.error('pool_error', err instanceof Error ? err : String(err), { action: 'add' });
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
        globalLogger.info('pool_remove', { pool: this.pool.length, max: this.config.maxEngines });
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
        globalLogger.info('pool_dead', { action: 'purge' });
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

    globalLogger.info('pool_scale_up', { qLen: this.queue.length, pool: this.pool.length });

    // Launch async scale-up (lock already taken)
    this.scaleUpLocked().catch(err => {
      globalLogger.error('pool_error', err instanceof Error ? err : String(err), { action: 'scale_up' });
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
        globalLogger.info('pool_dequeue', { req: request.id, waitMs: Date.now() - request.createdAt, qLen: this.queue.length });
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
        globalLogger.info('pool_scale_down', { status: 'check', pool: this.pool.length, avail: this.available.length, idleMs: idleTime, allIdle });
      }

      // 4) Scale down if conditions met
      if (hasExtraEngines && allIdle && idleTime > this.config.scaleDownIdleTime) {
        this.isScalingDown = true;
        try {
          const enginesToRemove = this.pool.length - this.config.minEngines;
          globalLogger.info('pool_scale_down', { status: 'trigger', removing: enginesToRemove, pool: this.pool.length });
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
        globalLogger.info('pool_assign', { req: request.id, pool: this.pool.length, avail: this.available.length });
        this.processRequest(engine, request);
      } else {
        // No engine available, add to queue
        this.queue.push(request);
        globalLogger.info('pool_queue', { req: request.id, qLen: this.queue.length, pool: this.pool.length });

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
          globalLogger.info('pool_restart', { req: request.id, status: 'cooldown', waitMs: 5000 - (now - lastRestart) });
          this.removeDeadEngine(engine);
          request.reject(new Error('Engine unavailable, please retry'));
          return;
        }

        globalLogger.info('pool_restart', { req: request.id, reason: 'dead' });
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
      const durationMs = Date.now() - request.createdAt;
      globalLogger.info('pool_done', { req: request.id, ms: durationMs, move: selectResult.bestMove });
      request.resolve(result);
    } catch (err) {
      globalLogger.error('pool_error', err instanceof Error ? err : String(err), { req: request.id, retry: retryCount });

      // Only retry once
      if (retryCount < MAX_RETRIES) {
        try {
          this.restartCooldowns.set(engine, Date.now());
          await engine.restart();
          globalLogger.info('pool_restart', { req: request.id, reason: 'error', status: 'ok' });

          // Retry the request with the restarted engine
          return this.processRequest(engine, request, retryCount + 1);
        } catch (restartErr) {
          globalLogger.error('pool_error', restartErr instanceof Error ? restartErr : String(restartErr), { req: request.id, action: 'restart' });
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

    globalLogger.info('pool_dead', { action: 'removed', pool: this.pool.length });

    // Ensure minimum engines (async, don't wait)
    if (this.pool.length < this.config.minEngines) {
      this.addEngine().catch(() => {
        globalLogger.error('pool_error', 'Failed to maintain minimum engines', { action: 'add_min' });
      });
    }
  }

  private returnEngine(engine: ChessEngine): void {
    // Only return healthy engines to the pool
    if (!engine.isAlive()) {
      globalLogger.info('pool_dead', { action: 'discard' });
      this.removeDeadEngine(engine);
      return;
    }

    // Check if there's a pending request
    const nextRequest = this.queue.shift();
    if (nextRequest) {
      globalLogger.info('pool_dequeue', { req: nextRequest.id, waitMs: Date.now() - nextRequest.createdAt, qLen: this.queue.length });
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
