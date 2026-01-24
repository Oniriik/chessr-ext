import { StockfishEngine, StockfishOptions } from './stockfish.js';
import { AnalysisResult, InfoUpdate } from './types.js';
import { selectMoveByElo, shouldBlunder, getMultiPVForElo } from './move-selector.js';

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

    console.log(`[Pool] Initializing with ${this.config.minEngines}-${this.config.maxEngines} engines...`);

    // Start with minimum engines
    for (let i = 0; i < this.config.minEngines; i++) {
      await this.addEngine();
    }

    this.initialized = true;
    this.startScaleDownMonitor();

    console.log(`[Pool] Ready with ${this.pool.length} engines`);
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
      console.log(`[Pool] Engine added (${this.pool.length}/${this.config.maxEngines})`);
      return engine;
    } catch (err) {
      console.error('[Pool] Failed to add engine:', err);
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
        console.log(`[Pool] Engine removed (${this.pool.length}/${this.config.maxEngines})`);
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
      const engine = this.available.pop();
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
      // Check if engine is still ready before using it
      if (!engine['isReady']) {
        throw new Error('Engine not ready');
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
      // Try to restart the engine
      console.error('[Pool] Engine error, attempting restart...');
      try {
        engine.quit();
        const newEngine = new StockfishEngine();
        await newEngine.init(this.config.engineOptions);

        // Replace in pool
        const index = this.pool.indexOf(engine);
        if (index !== -1) {
          this.pool[index] = newEngine;
        }

        // Retry the request with the new engine
        return this.processRequest(newEngine, request);
      } catch (restartErr) {
        console.error('[Pool] Failed to restart engine:', restartErr);
        request.reject(err instanceof Error ? err : new Error('Analysis failed'));
        // Return the broken engine to attempt recovery later
        this.returnEngine(engine);
        return;
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
    console.log(`[Pool] ELO ${elo} | Coups proposés: ${proposedMoves.join(' | ')}`);

    return {
      ...result,
      bestMove: selectedLine.moves[0],
      evaluation: selectedLine.evaluation,
      mate: selectedLine.mate,
      lines: reorderedLines,
    };
  }

  private returnEngine(engine: StockfishEngine): void {
    // Check if there's a pending request
    const nextRequest = this.queue.shift();
    if (nextRequest) {
      this.processRequest(engine, nextRequest);
    } else {
      this.available.push(engine);
    }
  }
}
