import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { PVLine, AnalysisResult, InfoUpdate } from "./types.js";
import { globalLogger } from "./logger.js";
import { getComparableCp } from "./eval-helpers.js";
import {
  calculateCPL,
  classifyMove,
  isMatemiss,
  cpToWinPercent,
  calculateMoveAccuracy,
} from "./stats-calculator.js";

// Engine path from environment or default
const ENGINE_PATH = process.env.ENGINE_PATH || "dragon-3.3";

function isValidFEN(fen: string): boolean {
  const parts = fen.split(" ");
  if (parts.length < 4) return false;

  const [board, turn, castling] = parts;

  // Check board has 8 ranks
  const ranks = board.split("/");
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
  if (turn !== "w" && turn !== "b") return false;

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

// Komodo Dragon Personalities (from official documentation):
// - Default: Strongest personality, full control over Contempt settings
// - Aggressive: Attacks relentlessly, prefers active pieces, biased toward Queen play
// - Defensive: Emphasizes king safety and solid position above all
// - Active: Tends toward open positions and well-placed pieces
// - Positional: Solid play, maneuvering, more closed positions
// - Endgame: Prefers playing through to win by promoting a pawn
// - Beginner: Doesn't understand fundamentals, looks to check and capture
// - Human: Optimized to play like strong human players, aggressive, avoids simplification
export type Personality =
  | "Default"
  | "Aggressive"
  | "Defensive"
  | "Active"
  | "Positional"
  | "Endgame"
  | "Beginner"
  | "Human";

export class ChessEngine {
  private process: ChildProcessWithoutNullStreams | null = null;
  private isReady = false;
  private buffer = "";

  private lines: PVLine[] = [];
  private currentDepth = 0;
  private currentEval = 0;
  private currentEvalCp = 0; // Evaluation in centipawns (no division)
  private currentMate: number | undefined;

  private onInfoCallback?: (info: InfoUpdate) => void;
  private resolveAnalysis?: (result: AnalysisResult) => void;
  private rejectAnalysis?: (error: Error) => void;

  private uciOkReceived = false;
  private readyOkReceived = false;
  private currentElo: number = 3500; // Track current ELO setting
  private currentPersonality: Personality = "Default"; // Track current personality

  async init(options: EngineOptions = {}): Promise<void> {
    this.uciOkReceived = false;
    this.readyOkReceived = false;
    this.isReady = false;

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(ENGINE_PATH);

        this.process.stdout.on("data", (data: Buffer) => {
          this.handleOutput(data.toString());
        });

        this.process.stderr.on("data", () => {
          // stderr ignored
        });

        this.process.on("error", (err) => {
          globalLogger.error("engine_error", err, { event: "process_error" });
          this.handleProcessDeath();
          reject(new Error(`Failed to start engine: ${err.message}`));
        });

        this.process.on("close", (code) => {
          // Only log if unexpected crash (non-zero exit code)
          // null means killed by signal (normal during scale down)
          if (code !== null && code !== 0) {
            globalLogger.info("engine_exit", { code });
          }
          this.handleProcessDeath();
        });

        // Handle stdin errors (EPIPE, etc.)
        this.process.stdin.on("error", (err) => {
          globalLogger.error("engine_error", err, { event: "stdin_error" });
          this.handleProcessDeath();
        });

        // Initialize UCI
        this.send("uci");

        // Wait for uciok
        const timeout = setTimeout(() => {
          reject(new Error("Engine initialization timeout"));
        }, 10000);

        const checkReady = setInterval(() => {
          if (this.uciOkReceived) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            this.configure(options);
            this.send("isready");

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
      this.rejectAnalysis(new Error("Engine process died"));
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

  private configure(options: EngineOptions) {
    const { elo = 1500, threads = 2, hash = 64 } = options;

    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${hash}`);
    this.setElo(elo);
  }

  setElo(elo: number) {
    this.currentElo = elo; // Track current setting
    // Use both Skill and UCI Elo for better chess.com calibration
    // Skill formula: (Level + 1) * 125 ≈ chess.com Elo
    // Skill 1 = ~250, Skill 23 = ~3000, Skill 25 = full strength
    const skill = Math.max(1, Math.min(25, Math.round(elo / 125) - 1));

    if (elo < 3500) {
      this.send(`setoption name Skill value ${skill}`);
      this.send("setoption name UCI LimitStrength value true");
      this.send(`setoption name UCI Elo value ${elo}`);
    } else {
      this.send("setoption name Skill value 25");
      this.send("setoption name UCI LimitStrength value false");
    }
  }

  setPersonality(personality: Personality) {
    this.currentPersonality = personality; // Track current setting
    // Set the Komodo Personality option directly
    // Komodo handles all internal adjustments for each personality
    this.send(`setoption name Personality value ${personality}`);
  }

  /**
   * Warm up hash tables by replaying game history with quick analyses
   * This builds transposition table entries for better final analysis
   * Also calculates player's ACPL for performance estimation
   */
  private warmupBestMoveReceived: boolean = false;

  private async warmupHash(
    moves: string[],
    playerColor: "w" | "b",
    useUserParams: boolean = false
  ): Promise<{
    acpl: number;
    movesAnalyzed: number;
    blunders: number;
    mistakes: number;
    inaccuracies: number;
    mateMisses: number;
    accuracy: number;
  }> {
    const WARMUP_DEPTH = 1; // Quick depth 1 for hash building

    // Configure engine strength based on context
    if (useUserParams) {
      // Use current user settings (already set by caller)
      // ELO and personality are already configured via setElo() and setPersonality()
      // No need to change anything
    } else {
      // Use full strength for stats (accurate ACPL calculation)
      this.send("setoption name UCI LimitStrength value false");
      this.send("setoption name Skill value 25"); // Max skill for Komodo
    }

    this.send("isready");
    await new Promise<void>((resolve) => {
      const checkReady = setInterval(() => {
        if (this.readyOkReceived) {
          this.readyOkReceived = false;
          clearInterval(checkReady);
          resolve();
        }
      }, 5);
    });

    let totalCPL = 0;
    let playerMoveCount = 0;
    let lastEval = 0;
    let lastMate: number | undefined;

    // Mistake classification counters
    let blunders = 0;
    let mistakes = 0;
    let inaccuracies = 0;
    let mateMisses = 0;

    // Lichess-style per-move accuracy tracking
    let totalAccuracy = 0;
    let accuracyMoveCount = 0;

    // Analyze all moves for stats (warmup all positions for hash table)
    const statsStartIndex = 0;

    for (let i = 0; i <= moves.length; i++) {
      const movesUpTo = moves.slice(0, i);
      const positionCmd =
        movesUpTo.length > 0
          ? `position startpos moves ${movesUpTo.join(" ")}`
          : "position startpos";

      // Determine whose turn it is at this position (before move i is played)
      const isWhiteTurn = i % 2 === 0;

      this.send(positionCmd);
      this.send(`go depth ${WARMUP_DEPTH}`);

      // Wait for bestmove response using dedicated flag
      this.warmupBestMoveReceived = false;
      await new Promise<void>((resolve) => {
        const checkBestMove = setInterval(() => {
          if (this.warmupBestMoveReceived) {
            this.warmupBestMoveReceived = false;
            clearInterval(checkBestMove);
            resolve();
          }
        }, 5);
      });

      // Get current eval using proper mate-to-CP conversion and perspective normalization
      const currentEvalCp = getComparableCp(
        this.currentEval,
        this.currentMate,
        isWhiteTurn,
      );
      const currentMate = this.currentMate;

      // Calculate CPL for player moves (comparing eval before and after their move)
      // Only count stats for last 10 moves (but warmup all positions for hash table)
      if (i > 0 && i > statsStartIndex) {
        // Move i-1 was just played, check if it was the player's move
        const wasWhiteMove = (i - 1) % 2 === 0;
        const wasPlayerMove = (playerColor === "w") === wasWhiteMove;

        if (wasPlayerMove) {
          // Use new helpers for consistent CPL calculation
          const cpl = calculateCPL(lastEval, currentEvalCp);
          const classification = classifyMove(cpl);

          // Update counters based on classification
          if (classification === "blunder") {
            blunders++;
          } else if (classification === "mistake") {
            mistakes++;
          } else if (classification === "inaccuracy") {
            inaccuracies++;
          }

          // Check for mate misses
          if (isMatemiss(lastMate, currentMate)) {
            mateMisses++;
          }

          // Calculate Lichess-style per-move accuracy
          const winPercentBefore = cpToWinPercent(lastEval);
          const winPercentAfter = cpToWinPercent(currentEvalCp);
          const moveAccuracy = calculateMoveAccuracy(
            winPercentBefore,
            winPercentAfter,
          );
          totalAccuracy += moveAccuracy;
          accuracyMoveCount++;

          totalCPL += cpl; // Already capped at 1000 in calculateCPL
          playerMoveCount++;
        }
      }

      lastEval = currentEvalCp;
      lastMate = currentMate;
    }

    const acpl =
      playerMoveCount > 0 ? Math.round(totalCPL / playerMoveCount) : 0;
    const accuracy =
      accuracyMoveCount > 0 ? Math.round(totalAccuracy / accuracyMoveCount) : 0;
    return {
      acpl,
      movesAnalyzed: playerMoveCount,
      blunders,
      mistakes,
      inaccuracies,
      mateMisses,
      accuracy,
    };
  }

  async analyze(
    fen: string,
    options: {
      moves: string[];
      searchMode: "depth" | "time";
      depth: number;
      moveTime: number;
      multiPV: number;
    },
    onInfo?: (info: InfoUpdate) => void,
    warmupContext?: 'stats' | 'suggestions'
  ): Promise<AnalysisResult> {
    if (!this.isAlive()) {
      throw new Error("Engine not ready");
    }

    // Validate FEN to prevent engine crash
    if (!isValidFEN(fen)) {
      throw new Error("Invalid FEN position");
    }

    // Clear hash tables before each analysis
    // Engine pool shares engines between users, so we need fresh state
    this.send("ucinewgame");

    const computeStart = Date.now();
    let warmupTime = 0;
    let playerPerformance: AnalysisResult["playerPerformance"] | undefined;

    // Build hash progressively by replaying game history
    if (options.moves.length > 0) {
      const warmupStart = Date.now();
      // Extract player color from FEN (second field - side to move)
      const playerColor = fen.split(' ')[1] as 'w' | 'b';

      // Determine if warmup should use user params
      const useUserParams = warmupContext === 'suggestions';

      // For suggestions, only warmup last 3 moves (6 plies) to save time
      // For stats, warmup all moves for accurate ACPL calculation
      const movesToWarmup = warmupContext === 'suggestions'
        ? options.moves.slice(-6)  // Last 6 plies (3 full moves)
        : options.moves;

      const warmupResult = await this.warmupHash(movesToWarmup, playerColor, useUserParams);
      warmupTime = Date.now() - warmupStart;

      // For suggestions context: user settings already applied, no need to restore
      // For stats context: restore user settings after full-strength warmup
      if (options.searchMode === "time" && warmupContext !== 'suggestions') {
        this.setElo(this.currentElo);
        this.setPersonality(this.currentPersonality);

        // Wait for settings to be applied
        this.send("isready");
        await new Promise<void>((resolve) => {
          const checkReady = setInterval(() => {
            if (this.readyOkReceived) {
              this.readyOkReceived = false;
              clearInterval(checkReady);
              resolve();
            }
          }, 5);
        });
      }

      // Build player performance from warmup stats
      playerPerformance = {
        acpl: warmupResult.acpl,
        estimatedElo: 0, // Not calculated in this context
        accuracy: warmupResult.accuracy,
        movesAnalyzed: warmupResult.movesAnalyzed,
      };
    }

    const analysisStart = Date.now();

    // Cancel any pending analysis
    if (this.resolveAnalysis) {
      const oldResolve = this.resolveAnalysis;
      this.resolveAnalysis = undefined;
      this.rejectAnalysis = undefined;
      oldResolve({
        type: "result",
        bestMove: "",
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
      const timeoutDuration =
        options.searchMode === "time"
          ? options.moveTime + 10000
          : Math.max(30000, options.depth * 3000);

      const timeout = setTimeout(() => {
        if (this.resolveAnalysis) {
          globalLogger.error("engine_timeout", "No response from engine", {
            timeoutMs: timeoutDuration,
          });
          this.resolveAnalysis = undefined;
          this.rejectAnalysis = undefined;
          // Don't mark isReady=false here, let pool handle it
          reject(new Error("Analysis timeout"));
        }
      }, timeoutDuration);

      // Wrap original resolve to clear timeout and add timing
      const originalResolve = this.resolveAnalysis;
      this.resolveAnalysis = (result: AnalysisResult) => {
        clearTimeout(timeout);
        this.rejectAnalysis = undefined;

        // Add timing info to result
        const analysisTime = Date.now() - analysisStart;
        const totalCompute = Date.now() - computeStart;
        result.timing = {
          warmup: warmupTime,
          analysis: analysisTime,
          total: totalCompute,
        };

        // Add player performance from warmup
        if (playerPerformance) {
          result.playerPerformance = playerPerformance;
        }

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

      // MultiPV setting
      // Note: ELO and personality are already set before analyze() is called (by engine-pool)
      // and restored after warmup above, so we don't need to set them again here
      this.send(`setoption name MultiPV value ${options.multiPV}`);

      // Use move history if available, otherwise FEN
      if (options.moves.length > 0) {
        this.send(`position startpos moves ${options.moves.join(" ")}`);
      } else {
        this.send(`position fen ${fen}`);
      }

      if (options.searchMode === "time") {
        this.send(`go movetime ${options.moveTime}`);
      } else {
        this.send(`go depth ${options.depth}`);
      }
    });
  }

  /**
   * Analyze a position with node-limited search
   * Used by CandidateSelector for quick evaluations
   * @param positionCmd - UCI position command (e.g., "position fen ..." or "position startpos moves ...")
   * @param nodes - Number of nodes to search
   * @returns Evaluation in centipawns (side-to-move perspective), mate info, and best move
   */
  async analyzeNodes(
    positionCmd: string,
    nodes: number,
  ): Promise<{ evalCp: number; mate?: number; bestMove: string }> {
    if (!this.isAlive()) {
      throw new Error("Engine not ready");
    }

    return new Promise((resolve, reject) => {
      this.lines = [];
      this.currentDepth = 0;
      this.currentEval = 0;
      this.currentEvalCp = 0;
      this.currentMate = undefined;

      const timeout = setTimeout(() => {
        reject(new Error("Node analysis timeout"));
      }, 30000);

      this.resolveAnalysis = (result) => {
        clearTimeout(timeout);
        resolve({
          evalCp: this.currentEvalCp,
          mate: result.mate,
          bestMove: result.bestMove,
        });
      };

      this.rejectAnalysis = (error) => {
        clearTimeout(timeout);
        reject(error);
      };

      this.send(positionCmd);
      this.send(`go nodes ${nodes}`);
    });
  }

  /**
   * Send a raw UCI command to the engine
   * Used by CandidateSelector for setup commands
   */
  sendCommand(command: string): void {
    this.send(command);
  }

  /**
   * Wait for engine to be ready after configuration changes
   */
  async waitReady(): Promise<void> {
    this.readyOkReceived = false;
    this.send("isready");
    await new Promise<void>((resolve) => {
      const checkReady = setInterval(() => {
        if (this.readyOkReceived) {
          this.readyOkReceived = false;
          clearInterval(checkReady);
          resolve();
        }
      }, 5);
    });
  }

  quit() {
    this.isReady = false;
    if (this.process) {
      try {
        if (!this.process.killed && this.process.stdin.writable) {
          this.process.stdin.write("quit\n");
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
        this.process.stdin.write(command + "\n");
      } catch (err) {
        globalLogger.error(
          "engine_error",
          err instanceof Error ? err : String(err),
          { event: "write_failed", command },
        );
        this.isReady = false;
      }
    } else {
      // Don't log for 'quit' commands on dead processes
      if (command !== "quit") {
        globalLogger.error("engine_error", "Process not available", {
          event: "send_failed",
          command,
        });
      }
      this.isReady = false;
    }
  }

  private handleOutput(data: string) {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      this.parseLine(line);
    }
  }

  private parseLine(line: string) {
    if (line === "uciok") {
      this.uciOkReceived = true;
    } else if (line === "readyok") {
      this.readyOkReceived = true;
    } else if (line.startsWith("info ") && line.includes("score")) {
      this.parseInfo(line);
    } else if (line.startsWith("bestmove ")) {
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

    let evalCp = 0;
    if (cpMatch) {
      evalCp = parseInt(cpMatch[1]);
      evaluation = evalCp / 100;
    } else if (mateMatch) {
      mate = parseInt(mateMatch[1]);
      evalCp = Math.sign(mate) * (100000 - Math.abs(mate) * 1000);
      evaluation = mate > 0 ? 100 : -100;
    }

    const moves = pvMatch ? pvMatch[1].split(" ") : [];

    // Store this line
    this.lines[multipv - 1] = { moves, evaluation, mate };
    this.currentDepth = depth;
    this.currentEval = evaluation;
    this.currentEvalCp = evalCp; // Store in centipawns
    this.currentMate = mate;

    // Send info update for multipv 1
    if (multipv === 1 && this.onInfoCallback) {
      this.onInfoCallback({
        type: "info",
        depth,
        evaluation,
        mate,
      });
    }
  }

  private parseBestMove(line: string) {
    const parts = line.split(" ");
    const bestMove = parts[1];
    const ponder = parts[3];

    // Set warmup flag (used during warmup phase)
    this.warmupBestMoveReceived = true;

    if (this.resolveAnalysis) {
      this.resolveAnalysis({
        type: "result",
        bestMove,
        ponder,
        evaluation: this.currentEval,
        mate: this.currentMate,
        lines: this.lines.filter((l) => l),
        depth: this.currentDepth,
      });
      this.resolveAnalysis = undefined;
    }
  }
}
