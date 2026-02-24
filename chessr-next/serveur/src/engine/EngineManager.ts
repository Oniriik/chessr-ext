/**
 * EngineManager - Manages a single UCI engine process (Komodo or Stockfish)
 * Handles communication via stdin/stdout
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type EngineType = 'komodo' | 'stockfish';

export interface SearchOptions {
  nodes?: number;
  depth?: number;
  moves?: string[];
}

export interface RawSuggestion {
  multipv: number;
  move: string;
  evaluation: number;
  depth: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  mateScore: number | null;
  pv: string[];  // Full principal variation (all moves)
}

export class EngineManager extends EventEmitter {
  public id: number;
  public engineType: EngineType;
  public isReady: boolean = false;
  public isBusy: boolean = false;

  private process: ChildProcess | null = null;
  private buffer: string = '';

  constructor(id: number = 0, engineType: EngineType = 'komodo') {
    super();
    this.id = id;
    this.engineType = engineType;
  }

  /**
   * Get engine path based on platform and engine type
   */
  private getEnginePath(): string {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'darwin' && arch === 'arm64') {
      return this.engineType === 'stockfish'
        ? path.join(__dirname, '../../engines/macos/stockfish-m1')
        : path.join(__dirname, '../../engines/macos/dragon-m1');
    } else if (platform === 'linux') {
      return this.engineType === 'stockfish'
        ? path.join(__dirname, '../../engines/linux/stockfish-avx2')
        : path.join(__dirname, '../../engines/linux/dragon-avx2');
    }
    throw new Error(`Unsupported platform: ${platform} ${arch}`);
  }

  /**
   * Start the engine process
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const enginePath = this.getEnginePath();

      console.log(`[Engine ${this.id}] Starting ${this.engineType}: ${enginePath}`);

      this.process = spawn(enginePath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleOutput(data.toString());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error(`[Engine ${this.id} stderr]`, data.toString().trim());
      });

      this.process.on('error', (err: Error) => {
        console.error(`[Engine ${this.id}] Process error:`, err);
        reject(err);
      });

      this.process.on('close', (code: number | null) => {
        console.log(`[Engine ${this.id}] Process exited with code ${code}`);
        this.isReady = false;
        this.isBusy = false;
      });

      // Initialize UCI
      this.sendCommand('uci');

      // Wait for "uciok"
      this.waitForResponse('uciok', 10000)
        .then(() => {
          this.isReady = true;
          console.log(`[Engine ${this.id}] UCI initialized`);
          resolve();
        })
        .catch(reject);
    });
  }

  /**
   * Send a command to the engine
   */
  sendCommand(command: string): void {
    if (this.process?.stdin) {
      this.process.stdin.write(command + '\n');
    }
  }

  /**
   * Handle engine output
   */
  private handleOutput(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.emit('line', line.trim());
      }
    }
  }

  /**
   * Wait for a specific response
   */
  waitForResponse(expected: string, timeout: number = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('line', handler);
        reject(new Error(`[Engine ${this.id}] Timeout waiting for ${expected}`));
      }, timeout);

      const handler = (line: string) => {
        if (line.includes(expected)) {
          clearTimeout(timer);
          this.removeListener('line', handler);
          resolve(line);
        }
      };

      this.on('line', handler);
    });
  }

  /**
   * Configure engine with UCI options
   */
  async configure(options: Record<string, string>): Promise<void> {
    for (const [name, value] of Object.entries(options)) {
      this.sendCommand(`setoption name ${name} value ${value}`);
    }
    this.sendCommand('isready');
    await this.waitForResponse('readyok');
  }

  /**
   * Run search and collect results with WDL stats
   * Scores are normalized to white's perspective (positive = white advantage)
   * @param fen - Current position in FEN format
   * @param multiPv - Number of principal variations to return
   * @param options - Search options: nodes, depth, or moves for game context
   */
  async search(fen: string, multiPv: number, options: SearchOptions = {}): Promise<RawSuggestion[]> {
    const { nodes = 700000, depth, moves } = options;
    this.isBusy = true;

    // Determine if black is to move from FEN (second field)
    const fenParts = fen.split(' ');
    const isBlackToMove = fenParts[1] === 'b';

    return new Promise((resolve, reject) => {
      const suggestions = new Map<string, RawSuggestion>(); // Key by move to avoid duplicates

      // Safety timeout (30 seconds max)
      const timeout = setTimeout(() => {
        this.removeListener('line', handler);
        this.isBusy = false;
        reject(new Error(`[Engine ${this.id}] Search timeout`));
      }, 30000);

      const handler = (line: string) => {
        // Parse "info" lines
        if (line.startsWith('info') && line.includes('pv')) {
          const parsed = this.parseInfoLine(line);
          if (parsed) {
            // Normalize scores to white's perspective
            // UCI reports from side-to-move, so negate when black is to move
            if (isBlackToMove) {
              parsed.evaluation = -parsed.evaluation;
              if (parsed.mateScore !== null) {
                parsed.mateScore = -parsed.mateScore;
              }
              // Swap win/loss rates
              const tempWin = parsed.winRate;
              parsed.winRate = parsed.lossRate;
              parsed.lossRate = tempWin;
            }
            // Use move as key to keep only the latest info for each move
            // This handles engines that update the same move multiple times
            suggestions.set(parsed.move, parsed);
          }
        }

        // "bestmove" signals end of search
        if (line.startsWith('bestmove')) {
          clearTimeout(timeout);
          this.removeListener('line', handler);
          this.isBusy = false;

          // Convert map to array, keep engine's original multipv ordering
          const result = Array.from(suggestions.values())
            .sort((a, b) => a.multipv - b.multipv)
            .slice(0, multiPv);

          resolve(result);
        }
      };

      this.on('line', handler);

      // Reset engine state
      this.sendCommand('ucinewgame');

      // Set position: use moves if available (for game context), otherwise use FEN
      if (moves && moves.length > 0) {
        // Replay game from start position with all moves (preserves threefold/50-move context)
        this.sendCommand(`position startpos moves ${moves.join(' ')}`);
      } else {
        // Fallback to FEN-only (no game history context)
        this.sendCommand(`position fen ${fen}`);
      }

      // Start search with depth or nodes limit
      if (depth) {
        this.sendCommand(`go depth ${depth}`);
      } else {
        this.sendCommand(`go nodes ${nodes}`);
      }
    });
  }

  /**
   * Parse UCI info line into suggestion format
   */
  private parseInfoLine(line: string): RawSuggestion | null {
    try {
      // Extract multipv (default to 1)
      const multipvMatch = line.match(/\bmultipv\s+(\d+)/);
      const multipv = multipvMatch ? parseInt(multipvMatch[1]) : 1;

      // Extract full PV (all moves after "pv")
      const pvMatch = line.match(/\bpv\s+(.+)$/);
      if (!pvMatch) return null;
      const pvMoves = pvMatch[1].split(/\s+/).filter(m => m.length >= 4);
      if (pvMoves.length === 0) return null;
      const move = pvMoves[0];

      // Extract depth
      const depthMatch = line.match(/\bdepth\s+(\d+)/);
      const depth = depthMatch ? parseInt(depthMatch[1]) : 0;

      // Extract evaluation (centipawns)
      let evaluation = 0;
      const scoreMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
      if (scoreMatch) {
        evaluation = parseInt(scoreMatch[1]);
      }

      // Extract WDL (Win/Draw/Loss) if available
      const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)/);
      let winRate = 50;
      let drawRate = 0;
      let lossRate = 50;

      if (wdlMatch) {
        // WDL values are per mille (0-1000)
        winRate = parseInt(wdlMatch[1]) / 10;
        drawRate = parseInt(wdlMatch[2]) / 10;
        lossRate = parseInt(wdlMatch[3]) / 10;
      } else if (scoreMatch) {
        // Fallback: Convert centipawns to win probability
        winRate = 50 + (50 * (2 / (1 + Math.exp(-evaluation / 400)) - 1));
        winRate = Math.round(winRate * 10) / 10;
        lossRate = 100 - winRate;
      }

      // Handle mate scores
      const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
      let mateScore: number | null = null;
      if (mateMatch) {
        mateScore = parseInt(mateMatch[1]);
        // Set evaluation to large value for mate
        evaluation = mateScore > 0 ? 10000 : -10000;
        if (mateScore > 0) {
          winRate = 100;
          drawRate = 0;
          lossRate = 0;
        } else {
          winRate = 0;
          drawRate = 0;
          lossRate = 100;
        }
      }

      return {
        multipv,
        move,
        evaluation,
        depth,
        winRate: Math.round(winRate * 10) / 10,
        drawRate: Math.round(drawRate * 10) / 10,
        lossRate: Math.round(lossRate * 10) / 10,
        mateScore,
        pv: pvMoves,
      };
    } catch {
      return null;
    }
  }

  /**
   * Stop the engine
   */
  stop(): void {
    if (this.process) {
      this.sendCommand('quit');
      this.process.kill();
      this.process = null;
      this.isReady = false;
      this.isBusy = false;
    }
  }
}
