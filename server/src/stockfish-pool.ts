import { StockfishEngine, StockfishOptions } from './stockfish.js';
import { AnalysisResult, InfoUpdate } from './types.js';
import { selectMoveByElo, shouldBlunder, getMultiPVForElo } from './move-selector.js';
import { globalLogger } from './logger.js';

interface AnalysisRequest {
  fen: string;
  options: {
    searchMode: 'depth' | 'time';
    depth: number;
    moveTime: number;
    multiPV: number;
    elo: number;
    mode: 'safe' | 'balanced' | 'aggressive' | 'blitz' | 'positional' | 'tactical';
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
  engineOptions: StockfishOptions;
}

export class StockfishPool {
  private pool: StockfishEngine[] = [];
  private available: StockfishEngine[] = [];
  private queue: AnalysisRequest[] = [];
  private config: PoolConfig;
  private initialized = false;
  private lastActivityTime = Date.now();
  private scaleDownTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<PoolConfig> = {}) {
    this.config = {
      minEngines: config.minEngines ?? 2,
      maxEngines: config.maxEngines ?? 8,
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

  private async addEngine(): Promise<StockfishEngine | null> {
    if (this.pool.length >= this.config.maxEngines) {
      return null;
    }

    try {
      const engine = new StockfishEngine();
      await engine.init(this.config.engineOptions);
      this.pool.push(engine);
      this.available.push(engine);
      globalLogger.info('pool_engine_added', { current: this.pool.length, max: this.config.maxEngines });
      return engine;
    } catch (err) {
      globalLogger.error('pool_engine_error', err instanceof Error ? err : String(err), { action: 'add' });
      return null;
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
        this.removeEngine();
      }
    }, 10000); // Check every 10 seconds
  }

  async analyze(
    fen: string,
    options: {
      searchMode?: 'depth' | 'time';
      depth: number;
      moveTime?: number;
      multiPV: number;
      elo: number;
      mode?: 'safe' | 'balanced' | 'aggressive' | 'blitz' | 'positional' | 'tactical';
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
          searchMode: options.searchMode || 'depth',
          depth: options.depth,
          moveTime: options.moveTime || 1000,
          multiPV: options.multiPV,
          elo: options.elo,
          mode: options.mode || 'balanced',
        },
        onInfo,
        resolve,
        reject,
      };

      // Try to get an available engine immediately
      // Prefer healthy engines
      let engine: StockfishEngine | undefined;
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

  private async processRequest(engine: StockfishEngine, request: AnalysisRequest): Promise<void> {
    this.lastActivityTime = Date.now();

    try {
      // Check if engine is still alive before using it
      if (!engine.isAlive()) {
        globalLogger.info('pool_engine_restart', { reason: 'dead_before_use' });
        await engine.restart();
      }

      engine.setElo(request.options.elo);
      engine.setMode(request.options.mode);

      // Use dynamic multiPV based on ELO for better move variety at low levels
      const effectiveMultiPV = Math.max(
        request.options.multiPV,
        getMultiPVForElo(request.options.elo)
      );

      const result = await engine.analyze(
        request.fen,
        {
          searchMode: request.options.searchMode,
          depth: request.options.depth,
          moveTime: request.options.moveTime,
          multiPV: effectiveMultiPV,
        },
        request.onInfo
      );

      // Apply ELO-based move selection (humanize the play)
      const adjustedResult = this.applyMoveSelection(result, request.options.elo);

      request.resolve(adjustedResult);
    } catch (err) {
      // Try to restart the engine and retry once
      globalLogger.error('pool_engine_error', err instanceof Error ? err : String(err), { action: 'restart' });
      try {
        await engine.restart();
        globalLogger.info('pool_engine_restart', { reason: 'error_recovery', status: 'success' });

        // Retry the request with the restarted engine
        return this.processRequest(engine, request);
      } catch (restartErr) {
        globalLogger.error('pool_engine_error', restartErr instanceof Error ? restartErr : String(restartErr), { action: 'restart_failed' });

        // Try to create a completely new engine
        try {
          const newEngine = new StockfishEngine();
          await newEngine.init(this.config.engineOptions);

          // Replace in pool
          const index = this.pool.indexOf(engine);
          if (index !== -1) {
            this.pool[index] = newEngine;
          }

          globalLogger.info('pool_engine_added', { reason: 'replacement', status: 'success' });
          return this.processRequest(newEngine, request);
        } catch (newEngineErr) {
          globalLogger.error('pool_engine_error', newEngineErr instanceof Error ? newEngineErr : String(newEngineErr), { action: 'replacement_failed' });
          request.reject(err instanceof Error ? err : new Error('Analysis failed'));
          this.returnEngine(engine);
          return;
        }
      }
    }

    // Return engine to pool and process next request
    this.returnEngine(engine);
  }

  /**
   * Apply ELO-based move selection to make the engine play more human-like
   * At lower ELOs, sometimes select suboptimal moves
   * Always returns exactly 3 lines, with the selected move as "best"
   */
  private applyMoveSelection(result: AnalysisResult, elo: number): AnalysisResult {
    const MAX_LINES = 3;

    // Need at least 2 lines to consider alternatives
    if (result.lines.length < 2) {
      return {
        ...result,
        lines: result.lines.slice(0, MAX_LINES),
      };
    }

    let selectedIndex = 0;

    // Check for blunder at very low ELOs
    if (shouldBlunder(elo) && result.lines.length >= 2) {
      // Pick a random worse move from available lines
      // At very low ELO, can pick from all 8 lines
      const maxBlunderIndex = Math.min(result.lines.length - 1, 7);
      selectedIndex = Math.floor(Math.random() * maxBlunderIndex) + 1; // Pick 2nd to 8th best
    } else {
      // Apply weighted move selection
      const selection = selectMoveByElo(result.lines, elo);
      selectedIndex = selection.selectedIndex;
    }

    // Build reordered lines: selected move first, then others
    const selectedLine = result.lines[selectedIndex];
    if (!selectedLine || selectedLine.moves.length === 0) {
      return {
        ...result,
        lines: result.lines.slice(0, MAX_LINES),
      };
    }

    // Create new lines array with selected move first
    const reorderedLines = [selectedLine];
    for (let i = 0; i < result.lines.length && reorderedLines.length < MAX_LINES; i++) {
      if (i !== selectedIndex && result.lines[i].moves.length > 0) {
        reorderedLines.push(result.lines[i]);
      }
    }

    // Log the 3 proposed moves with their real positions
    const proposedMoves = reorderedLines.map((line, idx) => {
      const realPosition = result.lines.findIndex(l => l.moves[0] === line.moves[0]) + 1;
      return `${idx + 1}. ${line.moves[0]} (réel: ${realPosition}${realPosition === 1 ? 'er' : 'e'}, eval: ${line.mate ? `M${line.mate}` : line.evaluation.toFixed(2)})`;
    });
    globalLogger.info('pool_moves', { elo, moves: proposedMoves.join(' | ') });

    return {
      ...result,
      bestMove: selectedLine.moves[0],
      evaluation: selectedLine.evaluation,
      mate: selectedLine.mate,
      lines: reorderedLines,
    };
  }

  private returnEngine(engine: StockfishEngine): void {
    // Only return healthy engines to the pool
    if (!engine.isAlive()) {
      globalLogger.info('pool_engine_dead', { action: 'discarding' });
    }

    // Check if there's a pending request
    const nextRequest = this.queue.shift();
    if (nextRequest) {
      this.processRequest(engine, nextRequest);
    } else {
      this.available.push(engine);
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
