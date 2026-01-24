import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { PVLine, AnalysisResult, InfoUpdate } from './types.js';

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

export interface StockfishOptions {
  elo?: number;
  threads?: number;
  hash?: number;
}

export class StockfishEngine {
  private process: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private buffer = '';

  private lines: PVLine[] = [];
  private currentDepth = 0;
  private currentEval = 0;
  private currentMate: number | undefined;

  private onInfoCallback?: (info: InfoUpdate) => void;
  private resolveAnalysis?: (result: AnalysisResult) => void;

  private uciOkReceived = false;
  private readyOkReceived = false;

  async init(options: StockfishOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.process = spawn('stockfish');

        this.process.stdout.on('data', (data: Buffer) => {
          this.handleOutput(data.toString());
        });

        this.process.stderr.on('data', () => {
          // stderr ignored
        });

        this.process.on('error', (err) => {
          console.error('[Stockfish] Process error:', err.message);
          this.isReady = false;
          if (err) {
            reject(new Error(`Failed to start Stockfish: ${err.message}`));
          }
        });

        this.process.on('close', (code) => {
          console.log('[Stockfish] Process closed with code:', code);
          this.isReady = false;
        });

        // Handle stdin errors (EPIPE, etc.)
        this.process.stdin.on('error', (err) => {
          console.error('[Stockfish] stdin error:', err.message);
          this.isReady = false;
        });

        // Initialize UCI
        this.send('uci');

        // Wait for uciok
        const timeout = setTimeout(() => {
          reject(new Error('Stockfish initialization timeout'));
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

  private configure(options: StockfishOptions) {
    const { elo = 1500, threads = 2, hash = 64 } = options;

    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${hash}`);
    this.setElo(elo);
  }

  setElo(elo: number) {
    if (elo < 3000) {
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${elo}`);
    } else {
      this.send('setoption name UCI_LimitStrength value false');
    }
  }

  setMode(mode: 'safe' | 'balanced' | 'aggressive' | 'blitz' | 'positional' | 'tactical') {
    // Mode configurations:
    // - Contempt: how much the engine avoids draws (-100 to +100)
    // - Slow Mover: time management (10-1000, lower = faster decisions)
    const modeConfig = {
      safe:        { contempt: -25, slowMover: 100 },  // Solid, accepts draws
      balanced:    { contempt: 0,   slowMover: 100 },  // Neutral play
      aggressive:  { contempt: 100, slowMover: 100 },  // Avoids draws, seeks complications
      blitz:       { contempt: 50,  slowMover: 50 },   // Fast decisions, slightly aggressive
      positional:  { contempt: -50, slowMover: 120 },  // Very solid, patient play
      tactical:    { contempt: 100, slowMover: 80 },   // Aggressive, seeks tactics
    };

    const config = modeConfig[mode];
    this.send(`setoption name Contempt value ${config.contempt}`);
    this.send(`setoption name Slow Mover value ${config.slowMover}`);
  }

  async analyze(
    fen: string,
    options: {
      searchMode: 'depth' | 'time';
      depth: number;
      moveTime: number;
      multiPV: number;
    },
    onInfo?: (info: InfoUpdate) => void
  ): Promise<AnalysisResult> {
    if (!this.isReady || !this.process) {
      throw new Error('Stockfish not ready');
    }

    // Validate FEN to prevent Stockfish crash
    if (!isValidFEN(fen)) {
      throw new Error('Invalid FEN position');
    }

    // Cancel any pending analysis
    if (this.resolveAnalysis) {
      const oldResolve = this.resolveAnalysis;
      this.resolveAnalysis = undefined;
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

      // Set timeout to prevent hanging (add 5 seconds buffer)
      const timeoutDuration = options.searchMode === 'time'
        ? options.moveTime + 5000
        : 30000; // 30s for depth-based search

      const timeout = setTimeout(() => {
        if (this.resolveAnalysis) {
          console.error('[Stockfish] Analysis timeout - no response from engine');
          this.resolveAnalysis = undefined;
          this.isReady = false;
          reject(new Error('Analysis timeout'));
        }
      }, timeoutDuration);

      // Wrap original resolve to clear timeout
      const originalResolve = this.resolveAnalysis;
      this.resolveAnalysis = (result: AnalysisResult) => {
        clearTimeout(timeout);
        if (originalResolve) {
          originalResolve(result);
        }
      };

      this.send(`setoption name MultiPV value ${options.multiPV}`);
      this.send(`position fen ${fen}`);

      if (options.searchMode === 'time') {
        this.send(`go movetime ${options.moveTime}`);
      } else {
        this.send(`go depth ${options.depth}`);
      }
    });
  }

  quit() {
    if (this.process) {
      this.send('quit');
      this.process.kill();
      this.process = null;
      this.isReady = false;
    }
  }

  private send(command: string) {
    if (this.process && !this.process.killed && this.process.stdin.writable) {
      try {
        this.process.stdin.write(command + '\n');
      } catch (err) {
        console.error('[Stockfish] Failed to write command:', command, err);
        this.isReady = false;
      }
    } else {
      console.warn('[Stockfish] Cannot send command, process not available:', command);
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
