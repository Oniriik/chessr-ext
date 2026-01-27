import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PVLine, AnalysisResult, InfoUpdate } from './types.js';
import { globalLogger } from './logger.js';

// Engine path from environment or default
const ENGINE_PATH = process.env.ENGINE_PATH || 'dragon-3.3';

function isValidFEN(fen: string): boolean {
  const parts = fen.split(' ');
  if (parts.length < 4) return false;

  const [board, turn, castling] = parts;

  // Check board has 8 ranks
  const ranks = board.split('/');
  if (ranks.length !== 8) return false;

  // Check each rank sums to 8
  for (const rank of ranks) {
    let count = 0;
    for (const char of rank) {
      if (/\d/.test(char)) {
        count += parseInt(char);
      } else if (/[prnbqkPRNBQK]/.test(char)) {
        count++;
      } else {
        return false;
      }
    }
    if (count !== 8) return false;
  }

  // Check turn
  if (turn !== 'w' && turn !== 'b') return false;

  // Check castling
  if (!/^(-|[KQkq]+)$/.test(castling)) return false;

  // Check we have exactly one white king and one black king
  const whiteKings = (board.match(/K/g) || []).length;
  const blackKings = (board.match(/k/g) || []).length;
  if (whiteKings !== 1 || blackKings !== 1) return false;

  return true;
}

export interface EngineOptions {
  elo?: number;
  threads?: number;
  hash?: number;
}

// Play modes with their descriptions:
// - default: Komodo defaults, no tweaks, no LimitStrength
// - safe: Human-like cautious play, accepts draws, protects king
// - balanced: Human-like balanced play, neutral style
// - aggressive: Optimal attacking play, avoids draws, sacrifices for initiative
// - positional: Optimal strategic play, solid structure, long-term plans
// - tactical: Optimal tactical play, seeks complications and combinations
// - creative: Unpredictable play with surprising moves
// - inhuman: Pure engine play, maximum strength, no human patterns
export type PlayMode = 'default' | 'safe' | 'balanced' | 'aggressive' | 'positional' | 'tactical' | 'creative' | 'inhuman';

interface ModeConfig {
  personality: string;
  contempt: number;
  kingSafety: number;
  dynamism: number;
  selectivity: number;
  variety: number;
}

export class ChessEngine {
  private process: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private buffer = '';

  private lines: PVLine[] = [];
  private currentDepth = 0;
  private currentEval = 0;
  private currentMate: number | undefined;

  private onInfoCallback?: (info: InfoUpdate) => void;
  private resolveAnalysis?: (result: AnalysisResult) => void;
  private rejectAnalysis?: (error: Error) => void;

  private uciOkReceived = false;
  private readyOkReceived = false;
  private lastOptions: EngineOptions = {};

  async init(options: EngineOptions = {}): Promise<void> {
    this.lastOptions = options;
    this.uciOkReceived = false;
    this.readyOkReceived = false;
    this.isReady = false;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(ENGINE_PATH);

        this.process.stdout.on('data', (data: Buffer) => {
          this.handleOutput(data.toString());
        });

        this.process.stderr.on('data', () => {
          // stderr ignored
        });

        this.process.on('error', (err) => {
          globalLogger.error('engine_error', err, { event: 'process_error' });
          this.handleProcessDeath();
          reject(new Error(`Failed to start engine: ${err.message}`));
        });

        this.process.on('close', (code) => {
          // Only log if unexpected (code !== 0 or null means crash)
          if (code !== 0) {
            globalLogger.info('engine_exit', { code });
          }
          this.handleProcessDeath();
        });

        // Handle stdin errors (EPIPE, etc.)
        this.process.stdin.on('error', (err) => {
          globalLogger.error('engine_error', err, { event: 'stdin_error' });
          this.handleProcessDeath();
        });

        // Initialize UCI
        this.send('uci');

        // Wait for uciok
        const timeout = setTimeout(() => {
          reject(new Error('Engine initialization timeout'));
        }, 10000);

        const checkReady = setInterval(() => {
          if (this.uciOkReceived) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            this.configure(options);
            this.send('isready');

            const readyCheck = setInterval(() => {
              if (this.readyOkReceived) {
                clearInterval(readyCheck);
                this.isReady = true;
                resolve();
              }
            }, 50);
          }
        }, 50);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Handle process death - reject any pending analysis
   */
  private handleProcessDeath(): void {
    this.isReady = false;
    this.process = null;
    if (this.rejectAnalysis) {
      this.rejectAnalysis(new Error('Engine process died'));
      this.rejectAnalysis = undefined;
      this.resolveAnalysis = undefined;
    }
  }

  /**
   * Check if engine is alive and ready
   */
  isAlive(): boolean {
    return this.isReady && this.process !== null && !this.process.killed;
  }

  /**
   * Restart the engine (call after crash)
   */
  async restart(): Promise<void> {
    this.quit();
    await this.init(this.lastOptions);
  }

  private configure(options: EngineOptions) {
    const { elo = 1500, threads = 2, hash = 64 } = options;

    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${hash}`);
    this.setElo(elo);
  }

  setElo(elo: number) {
    // Always use UCI LimitStrength for ELO-based play
    // Komodo will naturally play at the target ELO level
    if (elo < 3500) {
      this.send('setoption name UCI LimitStrength value true');
      this.send(`setoption name UCI Elo value ${elo}`);
    } else {
      this.send('setoption name UCI LimitStrength value false');
    }
  }

  setMode(mode: PlayMode) {
    // Default mode: use Komodo's factory settings, no tweaks
    if (mode === 'default') {
      return;
    }

    // Mode configurations for Komodo Dragon
    // Each mode adjusts: Personality, Contempt, King Safety, Dynamism, Selectivity, Variety
    const modeConfigs: Record<Exclude<PlayMode, 'default'>, ModeConfig> = {
      // Human-like modes (use Human personality + variety for realistic play)
      safe: {
        personality: 'Human',
        contempt: -100,      // Accepts draws easily
        kingSafety: 120,     // Very protective of king
        dynamism: 50,        // Prefers solid structure
        selectivity: 180,    // High selectivity = more human errors
        variety: 35,         // Good randomization for human feel
      },
      balanced: {
        personality: 'Human',
        contempt: 0,         // Neutral on draws
        kingSafety: 83,      // Default king safety
        dynamism: 100,       // Balanced play
        selectivity: 170,    // Higher selectivity = more errors
        variety: 30,         // More randomization for human feel
      },
      // Precise modes (optimal play in their style)
      aggressive: {
        personality: 'Aggressive',
        contempt: 150,       // Avoids draws, fights for win
        kingSafety: 50,      // Willing to expose king for attack
        dynamism: 180,       // Very active piece play
        selectivity: 130,    // Good calculation
        variety: 0,          // Always best attacking move
      },
      positional: {
        personality: 'Positional',
        contempt: -50,       // Accepts draws if position is equal
        kingSafety: 100,     // Solid king position
        dynamism: 60,        // Prefers structure over activity
        selectivity: 110,    // Deep positional calculation
        variety: 0,          // Always best positional move
      },
      tactical: {
        personality: 'Active',
        contempt: 100,       // Prefers to fight
        kingSafety: 60,      // Some risk tolerance
        dynamism: 200,       // Maximum piece activity
        selectivity: 140,    // Good tactical vision
        variety: 5,          // Tiny randomization
      },
      creative: {
        personality: 'Default',
        contempt: 50,        // Slight fight preference
        kingSafety: 70,      // Moderate risk
        dynamism: 150,       // Active play
        selectivity: 140,    // Normal calculation
        variety: 50,         // High randomization for surprises
      },
      inhuman: {
        personality: 'Default',
        contempt: 250,       // Never accepts draws
        kingSafety: 30,      // King exposed if advantageous
        dynamism: 300,       // Maximum activity
        selectivity: 80,     // Deep calculation
        variety: 0,          // Always absolute best move
      },
    };

    const config = modeConfigs[mode];

    this.send(`setoption name Personality value ${config.personality}`);
    this.send(`setoption name Contempt value ${config.contempt}`);
    this.send(`setoption name King Safety value ${config.kingSafety}`);
    this.send(`setoption name Dynamism value ${config.dynamism}`);
    this.send(`setoption name Selectivity value ${config.selectivity}`);
    this.send(`setoption name Variety value ${config.variety}`);
  }

  async analyze(
    fen: string,
    options: {
      moves: string[];
      searchMode: 'depth' | 'time';
      depth: number;
      moveTime: number;
      multiPV: number;
    },
    onInfo?: (info: InfoUpdate) => void
  ): Promise<AnalysisResult> {
    if (!this.isAlive()) {
      throw new Error('Engine not ready');
    }

    // Validate FEN to prevent engine crash
    if (!isValidFEN(fen)) {
      throw new Error('Invalid FEN position');
    }

    // Clear hash tables before each analysis
    // Engine pool shares engines between users, so we need fresh state
    this.send('ucinewgame');

    // Cancel any pending analysis
    if (this.resolveAnalysis) {
      const oldResolve = this.resolveAnalysis;
      this.resolveAnalysis = undefined;
      this.rejectAnalysis = undefined;
      oldResolve({
        type: 'result',
        bestMove: '',
        evaluation: 0,
        lines: [],
        depth: 0,
      });
    }

    return new Promise((resolve, reject) => {
      this.lines = [];
      this.currentDepth = 0;
      this.currentEval = 0;
      this.currentMate = undefined;
      this.onInfoCallback = onInfo;
      this.resolveAnalysis = resolve;
      this.rejectAnalysis = reject;

      // Set timeout to prevent hanging
      // Depth 18 can take a while, use depth * 3 seconds with minimum 30s
      const timeoutDuration = options.searchMode === 'time'
        ? options.moveTime + 10000
        : Math.max(30000, options.depth * 3000);

      const timeout = setTimeout(() => {
        if (this.resolveAnalysis) {
          globalLogger.error('engine_timeout', 'No response from engine', { timeoutMs: timeoutDuration });
          this.resolveAnalysis = undefined;
          this.rejectAnalysis = undefined;
          // Don't mark isReady=false here, let pool handle it
          reject(new Error('Analysis timeout'));
        }
      }, timeoutDuration);

      // Wrap original resolve to clear timeout
      const originalResolve = this.resolveAnalysis;
      this.resolveAnalysis = (result: AnalysisResult) => {
        clearTimeout(timeout);
        this.rejectAnalysis = undefined;
        if (originalResolve) {
          originalResolve(result);
        }
      };

      // Wrap original reject to clear timeout
      const originalReject = this.rejectAnalysis;
      this.rejectAnalysis = (error: Error) => {
        clearTimeout(timeout);
        this.resolveAnalysis = undefined;
        if (originalReject) {
          originalReject(error);
        }
      };

      // Disable LimitStrength for depth mode (full engine strength for analysis)
      // For time mode, LimitStrength is already set by setElo() called before analyze()
      if (options.searchMode === 'depth') {
        this.send('setoption name UCI LimitStrength value false');
      }

      this.send(`setoption name MultiPV value ${options.multiPV}`);

      // Use move history if available, otherwise FEN
      if (options.moves.length > 0) {
        this.send(`position startpos moves ${options.moves.join(' ')}`);
      } else {
        this.send(`position fen ${fen}`);
      }

      if (options.searchMode === 'time') {
        this.send(`go movetime ${options.moveTime}`);
      } else {
        this.send(`go depth ${options.depth}`);
      }
    });
  }

  quit() {
    this.isReady = false;
    if (this.process) {
      try {
        if (!this.process.killed && this.process.stdin.writable) {
          this.process.stdin.write('quit\n');
        }
        this.process.kill();
      } catch {
        // Process already dead, ignore
      }
      this.process = null;
    }
  }

  private send(command: string) {
    if (this.process && !this.process.killed && this.process.stdin.writable) {
      try {
        this.process.stdin.write(command + '\n');
      } catch (err) {
        globalLogger.error('engine_error', err instanceof Error ? err : String(err), { event: 'write_failed', command });
        this.isReady = false;
      }
    } else {
      // Don't log for 'quit' commands on dead processes
      if (command !== 'quit') {
        globalLogger.error('engine_error', 'Process not available', { event: 'send_failed', command });
      }
      this.isReady = false;
    }
  }

  private handleOutput(data: string) {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      this.parseLine(line);
    }
  }

  private parseLine(line: string) {
    if (line === 'uciok') {
      this.uciOkReceived = true;
    } else if (line === 'readyok') {
      this.readyOkReceived = true;
    } else if (line.startsWith('info ') && line.includes('score')) {
      this.parseInfo(line);
    } else if (line.startsWith('bestmove ')) {
      this.parseBestMove(line);
    }
  }

  private parseInfo(line: string) {
    const depthMatch = line.match(/depth (\d+)/);
    const multipvMatch = line.match(/multipv (\d+)/);
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const pvMatch = line.match(/ pv (.+)$/);

    if (!depthMatch) return;

    const depth = parseInt(depthMatch[1]);
    const multipv = multipvMatch ? parseInt(multipvMatch[1]) : 1;

    let evaluation = 0;
    let mate: number | undefined;

    if (cpMatch) {
      evaluation = parseInt(cpMatch[1]) / 100;
    } else if (mateMatch) {
      mate = parseInt(mateMatch[1]);
      evaluation = mate > 0 ? 100 : -100;
    }

    const moves = pvMatch ? pvMatch[1].split(' ') : [];

    // Store this line
    this.lines[multipv - 1] = { moves, evaluation, mate };
    this.currentDepth = depth;
    this.currentEval = evaluation;
    this.currentMate = mate;

    // Send info update for multipv 1
    if (multipv === 1 && this.onInfoCallback) {
      this.onInfoCallback({
        type: 'info',
        depth,
        evaluation,
        mate,
      });
    }
  }

  private parseBestMove(line: string) {
    const parts = line.split(' ');
    const bestMove = parts[1];
    const ponder = parts[3];

    if (this.resolveAnalysis) {
      this.resolveAnalysis({
        type: 'result',
        bestMove,
        ponder,
        evaluation: this.currentEval,
        mate: this.currentMate,
        lines: this.lines.filter(l => l),
        depth: this.currentDepth,
      });
      this.resolveAnalysis = undefined;
    }
  }
}
