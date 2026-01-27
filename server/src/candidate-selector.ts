/**
 * Candidate Selector - ELO-tuned 3-move selection algorithm
 *
 * Replaces MultiPV with a more sophisticated selection:
 * 1. Get reference eval with nodesMain
 * 2. Generate 12-16 legal candidates (prioritize captures/checks)
 * 3. Quick-eval each with nodesCand
 * 4. Filter by windowCp acceptance
 * 5. Weighted selection with tempCp
 * 6. Pick 3 distinct moves (avoid similar)
 * 7. Verify final 3 with 20k nodes
 */

import { Chess, Move } from 'chess.js';
import { ChessEngine } from './engine.js';
import { getEloBand, toPlayerPov, mateToCp } from './elo-bands.js';
import { PVLine } from './types.js';
import { cpToWinPercent, calculateMoveAccuracy } from './stats-calculator.js';
import { globalLogger } from './logger.js';

interface EvalInfo {
  move: string;
  evalCp: number;  // centipawns, player perspective
  from: string;
  to: string;
  isCapture: boolean;
  isCheck: boolean;
}

interface SelectResult {
  lines: PVLine[];
  bestMove: string;
  evaluation: number;
  playerPerformance?: {
    accuracy: number;
    movesAnalyzed: number;
  };
}

const VERIFY_NODES = 20_000;
const MAX_DROP_CP = 200;
const WARMUP_NODES = 1500;
const MAX_WARMUP_PLIES = 8;

export class CandidateSelector {
  private chess: Chess;

  constructor(private engine: ChessEngine) {
    this.chess = new Chess();
  }

  async selectMoves(
    fen: string,
    moves: string[],
    elo: number,
    playerColor: 'w' | 'b'
  ): Promise<SelectResult> {
    const band = getEloBand(elo);

    globalLogger.info('candidate_selector_start', {
      elo,
      nodesMain: band.nodesMain,
      nodesCand: band.nodesCand,
      windowCp: band.windowCp,
      tempCp: band.tempCp,
      movesCount: moves.length,
    });

    // Configure engine for full strength analysis
    this.engine.sendCommand('setoption name MultiPV value 1');
    this.engine.sendCommand('setoption name Contempt value 0');
    this.engine.sendCommand('setoption name UCI LimitStrength value false');
    await this.engine.waitReady();

    // Step 1: Light warmup + accuracy calculation (last 6-10 plies)
    let playerPerformance: SelectResult['playerPerformance'] | undefined;
    if (moves.length > 0) {
      playerPerformance = await this.warmupAndCalculateAccuracy(moves, playerColor);
    }

    // Step 2: Get reference evaluation
    const positionCmd = moves.length > 0
      ? `position startpos moves ${moves.join(' ')}`
      : `position fen ${fen}`;

    const refResult = await this.engine.analyzeNodes(positionCmd, band.nodesMain);
    const sideToMove = this.getSideToMove(fen, moves);
    const bestEvalCp = toPlayerPov(refResult.evalCp, playerColor, sideToMove);
    const bestMove = refResult.bestMove;

    globalLogger.info('candidate_selector_reference', {
      bestMove,
      bestEvalCp,
      mate: refResult.mate,
    });

    // Step 3: Generate candidates
    const candidates = this.generateCandidates(fen, moves);

    globalLogger.info('candidate_selector_candidates', {
      count: candidates.length,
      moves: candidates.join(', '),
    });

    // Step 4: Quick-eval each candidate
    const scored: EvalInfo[] = [];
    for (const moveUci of candidates) {
      const info = this.getMoveInfo(fen, moves, moveUci);
      const candidatePositionCmd = moves.length > 0
        ? `position startpos moves ${moves.join(' ')} ${moveUci}`
        : `position fen ${fen} moves ${moveUci}`;

      const evalResult = await this.engine.analyzeNodes(candidatePositionCmd, band.nodesCand);

      // After playing a move, side to move changes
      const newSideToMove = sideToMove === 'w' ? 'b' : 'w';
      const evalCp = toPlayerPov(evalResult.evalCp, playerColor, newSideToMove);

      scored.push({
        move: moveUci,
        evalCp,
        ...info,
      });
    }

    // Ensure best move is included
    if (!scored.some(x => x.move === bestMove)) {
      const bestInfo = this.getMoveInfo(fen, moves, bestMove);
      scored.push({
        move: bestMove,
        evalCp: bestEvalCp,
        ...bestInfo,
      });
    }

    // Step 5: Filter by acceptance window
    let accepted = scored
      .filter(x => x.evalCp >= bestEvalCp - band.windowCp)
      .sort((a, b) => b.evalCp - a.evalCp);

    globalLogger.info('candidate_selector_accepted', {
      count: accepted.length,
      moves: accepted.map(x => `${x.move}(${x.evalCp})`).join(', '),
    });

    if (accepted.length === 0) {
      // Fallback: just return best move
      return {
        lines: [{ moves: [bestMove], evaluation: bestEvalCp / 100, mate: refResult.mate }],
        bestMove,
        evaluation: bestEvalCp / 100,
        playerPerformance,
      };
    }

    // Step 6: Weighted selection of 3 distinct moves
    const selected = this.selectDistinctMoves(accepted, bestEvalCp, band.tempCp, 3);

    globalLogger.info('candidate_selector_selected', {
      moves: selected.map(x => x.move).join(', '),
    });

    // Step 7: Verify final moves
    const verified: EvalInfo[] = [];
    for (const candidate of selected) {
      const verifyPositionCmd = moves.length > 0
        ? `position startpos moves ${moves.join(' ')} ${candidate.move}`
        : `position fen ${fen} moves ${candidate.move}`;

      const verifyResult = await this.engine.analyzeNodes(verifyPositionCmd, VERIFY_NODES);
      const newSideToMove = sideToMove === 'w' ? 'b' : 'w';
      const verifyEvalCp = toPlayerPov(verifyResult.evalCp, playerColor, newSideToMove);

      if (verifyEvalCp >= bestEvalCp - MAX_DROP_CP) {
        verified.push({ ...candidate, evalCp: verifyEvalCp });
      } else {
        globalLogger.info('candidate_selector_verify_rejected', {
          move: candidate.move,
          verifyEvalCp,
          bestEvalCp,
          drop: bestEvalCp - verifyEvalCp,
        });
      }
    }

    // Fill with fallback if verification removed some
    let finalMoves = verified;
    if (finalMoves.length < 3) {
      // First try to fill from accepted moves
      const remainingAccepted = accepted.filter(x => !finalMoves.some(f => f.move === x.move));
      while (finalMoves.length < 3 && remainingAccepted.length > 0) {
        finalMoves.push(remainingAccepted.shift()!);
      }
    }

    // If still < 3 moves (e.g., mate positions), fall back to best scored candidates
    if (finalMoves.length < 3) {
      const remainingScored = scored
        .filter(x => !finalMoves.some(f => f.move === x.move))
        .sort((a, b) => b.evalCp - a.evalCp); // Best first
      while (finalMoves.length < 3 && remainingScored.length > 0) {
        finalMoves.push(remainingScored.shift()!);
      }
    }

    // Ensure at least best move is returned
    if (finalMoves.length === 0) {
      finalMoves = [{
        move: bestMove,
        evalCp: bestEvalCp,
        from: '',
        to: '',
        isCapture: false,
        isCheck: false,
      }];
    }

    // Build result lines
    const lines: PVLine[] = finalMoves.slice(0, 3).map(m => ({
      moves: [m.move],
      evaluation: m.evalCp / 100,
      mate: undefined,
    }));

    globalLogger.info('candidate_selector_result', {
      moves: finalMoves.slice(0, 3).map(x => x.move).join(', '),
    });

    return {
      lines,
      bestMove: finalMoves[0]?.move || bestMove,
      evaluation: (finalMoves[0]?.evalCp || bestEvalCp) / 100,
      playerPerformance,
    };
  }

  /**
   * Light warmup on last N plies + accuracy calculation
   */
  private async warmupAndCalculateAccuracy(
    moves: string[],
    playerColor: 'w' | 'b'
  ): Promise<{ accuracy: number; movesAnalyzed: number }> {
    // Only analyze last MAX_WARMUP_PLIES moves for warmup
    const startIndex = Math.max(0, moves.length - MAX_WARMUP_PLIES);

    let totalAccuracy = 0;
    let movesAnalyzed = 0;
    let lastEvalCp = 0;

    for (let i = startIndex; i <= moves.length; i++) {
      const movesUpTo = moves.slice(0, i);
      const positionCmd = movesUpTo.length > 0
        ? `position startpos moves ${movesUpTo.join(' ')}`
        : 'position startpos';

      const isWhiteTurn = i % 2 === 0;
      const sideToMove = isWhiteTurn ? 'w' : 'b';

      const result = await this.engine.analyzeNodes(positionCmd, WARMUP_NODES);
      const currentEvalCp = toPlayerPov(result.evalCp, playerColor, sideToMove);

      // Calculate accuracy for player moves
      if (i > startIndex) {
        const wasWhiteMove = (i - 1) % 2 === 0;
        const wasPlayerMove = (playerColor === 'w') === wasWhiteMove;

        if (wasPlayerMove) {
          const winPercentBefore = cpToWinPercent(lastEvalCp);
          const winPercentAfter = cpToWinPercent(currentEvalCp);
          const moveAccuracy = calculateMoveAccuracy(winPercentBefore, winPercentAfter);
          totalAccuracy += moveAccuracy;
          movesAnalyzed++;
        }
      }

      lastEvalCp = currentEvalCp;
    }

    const accuracy = movesAnalyzed > 0 ? Math.round(totalAccuracy / movesAnalyzed) : 0;
    return { accuracy, movesAnalyzed };
  }

  /**
   * Generate 12-16 legal candidate moves, prioritizing captures and checks
   */
  private generateCandidates(fen: string, moves: string[]): string[] {
    // Set up position
    if (moves.length > 0) {
      this.chess.reset();
      for (const move of moves) {
        // Convert UCI to chess.js format
        const from = move.slice(0, 2);
        const to = move.slice(2, 4);
        const promotion = move.length > 4 ? move[4] : undefined;
        this.chess.move({ from, to, promotion });
      }
    } else {
      this.chess.load(fen);
    }

    const legalMoves = this.chess.moves({ verbose: true });

    // Categorize moves
    const captures: Move[] = [];
    const checks: Move[] = [];
    const promotions: Move[] = [];
    const others: Move[] = [];

    for (const move of legalMoves) {
      if (move.promotion) {
        promotions.push(move);
      } else if (move.captured) {
        captures.push(move);
      } else if (move.san.includes('+') || move.san.includes('#')) {
        checks.push(move);
      } else {
        others.push(move);
      }
    }

    // Build candidate list with priorities
    const candidates: string[] = [];
    const seen = new Set<string>();

    const addMove = (move: Move) => {
      const uci = move.from + move.to + (move.promotion || '');
      if (!seen.has(uci)) {
        seen.add(uci);
        candidates.push(uci);
      }
    };

    // Add in priority order: captures, checks, promotions, then others
    captures.slice(0, 6).forEach(addMove);
    checks.slice(0, 4).forEach(addMove);
    promotions.forEach(addMove);
    others.slice(0, 8).forEach(addMove);

    // Limit to 16 candidates
    return candidates.slice(0, 16);
  }

  /**
   * Get move info (from, to, isCapture, isCheck) for a UCI move
   */
  private getMoveInfo(fen: string, moves: string[], moveUci: string): {
    from: string;
    to: string;
    isCapture: boolean;
    isCheck: boolean;
  } {
    // Set up position
    if (moves.length > 0) {
      this.chess.reset();
      for (const move of moves) {
        const from = move.slice(0, 2);
        const to = move.slice(2, 4);
        const promotion = move.length > 4 ? move[4] : undefined;
        this.chess.move({ from, to, promotion });
      }
    } else {
      this.chess.load(fen);
    }

    const from = moveUci.slice(0, 2);
    const to = moveUci.slice(2, 4);
    const promotion = moveUci.length > 4 ? moveUci[4] : undefined;

    try {
      const result = this.chess.move({ from, to, promotion });
      const isCapture = !!result.captured;
      const isCheck = result.san.includes('+') || result.san.includes('#');
      this.chess.undo();

      return { from, to, isCapture, isCheck };
    } catch {
      return { from, to, isCapture: false, isCheck: false };
    }
  }

  /**
   * Get side to move from FEN or move count
   */
  private getSideToMove(fen: string, moves: string[]): 'w' | 'b' {
    if (moves.length > 0) {
      // Starting position is white, each move flips
      return moves.length % 2 === 0 ? 'w' : 'b';
    }
    return fen.split(' ')[1] as 'w' | 'b';
  }

  /**
   * Select 3 distinct moves using weighted random selection
   */
  private selectDistinctMoves(
    accepted: EvalInfo[],
    bestEvalCp: number,
    tempCp: number,
    count: number
  ): EvalInfo[] {
    const selected: EvalInfo[] = [];
    let pool = [...accepted];

    for (let k = 0; k < count && pool.length > 0; k++) {
      // Filter out too similar moves
      const needMoreMoves = selected.length < 2 && pool.length <= count - selected.length;
      const filtered = pool.filter(m => !selected.some(s => this.tooSimilar(m, s, needMoreMoves)));
      const candidates = filtered.length > 0 ? filtered : pool;

      // Build weights
      const weights = candidates.map(c => ({
        item: c,
        weight: Math.exp((c.evalCp - bestEvalCp) / tempCp),
      }));

      // Weighted random pick
      const pick = this.weightedPick(weights);
      selected.push(pick);
      pool = pool.filter(x => x.move !== pick.move);
    }

    return selected;
  }

  /**
   * Check if two moves are too similar
   * Hard rules: same from or same to (always reject)
   * Soft rules: both captures or both checks (only reject if we have enough moves)
   */
  private tooSimilar(a: EvalInfo, b: EvalInfo, needMoreMoves: boolean): boolean {
    // Hard rules - always applied
    if (a.from === b.from || a.to === b.to) return true;

    // Soft rules - only if we have enough moves
    if (!needMoreMoves) {
      if (a.isCapture && b.isCapture) return true;
      if (a.isCheck && b.isCheck) return true;
    }

    return false;
  }

  /**
   * Weighted random selection
   */
  private weightedPick<T>(items: { item: T; weight: number }[]): T {
    const totalWeight = items.reduce((sum, x) => sum + x.weight, 0);
    let r = Math.random() * totalWeight;
    for (const { item, weight } of items) {
      r -= weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1].item;
  }
}
