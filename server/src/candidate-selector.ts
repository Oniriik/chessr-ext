/**
 * Candidate Selector - ELO-tuned 3-move selection with quality buckets
 *
 * Algorithm:
 * 1. Get reference eval with nodesMain
 * 2. Generate up to 12 legal candidates (prioritize captures/checks)
 * 3. Quick-eval each with nodesCand
 * 4. Bucketize by quality (excellent/good/ok/inaccuracy/bad)
 * 5. Sample slot1 using quality targets distribution
 * 6. Sample slots 2-3 with clampQuality (not worse than slot1)
 * 7. Verify final 3 with 12k nodes
 * 8. Brilliant detection post-verify
 * 9. Optional reorder if showAlwaysBestMoveFirst
 *
 * INVARIANT: Always returns min(3, legalMoves.length) suggestions
 */

import { Chess, Move } from 'chess.js';
import { ChessEngine } from './engine.js';
import { getEloBand, toPlayerPov, EloBand } from './elo-bands.js';
import { PVLine } from './types.js';
import { cpToWinPercent, calculateMoveAccuracy } from './stats-calculator.js';
import { globalLogger } from './logger.js';

// Quality categories for selection (brilliant is post-verify annotation only)
type PickQuality = 'excellent' | 'good' | 'ok' | 'inaccuracy';
type Quality = PickQuality | 'bad';

const QUALITY_ORDER: PickQuality[] = ['excellent', 'good', 'ok', 'inaccuracy'];

interface BucketedCandidate {
  move: string;
  from: string;
  to: string;
  isCapture: boolean;
  isCheck: boolean;
  materialDrop: number;
  evalPlayerCp: number;
  lossCp: number;
  quality: Quality;
  isBrilliant?: boolean;
}

interface SelectResult {
  lines: PVLine[];
  bestMove: string;
  evaluation: number;
  playerPerformance?: {
    accuracy: number;
    movesAnalyzed: number;
  };
  timing?: {
    warmup: number;
    analysis: number;
    total: number;
  };
}

const VERIFY_NODES = 12_000;
const MAX_DROP_CP = 200;
const WARMUP_NODES = 1500;
const MAX_WARMUP_PLIES = 8;

const MATERIAL_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * Seeded PRNG (Mulberry32) for deterministic selection
 */
class SeededRNG {
  private seed: number;

  constructor(seedString: string) {
    this.seed = 0;
    for (let i = 0; i < seedString.length; i++) {
      this.seed = ((this.seed << 5) - this.seed + seedString.charCodeAt(i)) | 0;
    }
    if (this.seed === 0) this.seed = 1;
  }

  next(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/**
 * Assign quality bucket based on lossCp from best move
 */
function assignQuality(lossCp: number, thresholds: EloBand['qualityLossCp']): Quality {
  if (lossCp <= thresholds.excellent) return 'excellent';
  if (lossCp <= thresholds.good) return 'good';
  if (lossCp <= thresholds.ok) return 'ok';
  if (lossCp <= thresholds.inaccuracy) return 'inaccuracy';
  return 'bad';
}

/**
 * Sample a quality bucket based on target distribution
 */
function sampleQuality(targets: EloBand['qualityTargets'], rng: SeededRNG): PickQuality {
  const total = QUALITY_ORDER.reduce((s, k) => s + targets[k], 0);
  let r = rng.next() * total;
  for (const k of QUALITY_ORDER) {
    r -= targets[k];
    if (r <= 0) return k;
  }
  return 'inaccuracy';
}

/**
 * Degrade quality to next worse category
 */
function degradeQuality(q: PickQuality): PickQuality {
  const idx = QUALITY_ORDER.indexOf(q);
  return idx < QUALITY_ORDER.length - 1 ? QUALITY_ORDER[idx + 1] : 'inaccuracy';
}

/**
 * Clamp quality to be at least as good as minQuality
 */
function clampQuality(sampled: PickQuality, minQuality: PickQuality): PickQuality {
  const sampledIdx = QUALITY_ORDER.indexOf(sampled);
  const minIdx = QUALITY_ORDER.indexOf(minQuality);
  return QUALITY_ORDER[Math.min(sampledIdx, minIdx)];
}

/**
 * Count material for a given color
 */
function countMaterial(chess: Chess, color: 'w' | 'b'): number {
  const board = chess.board();
  let total = 0;
  for (const row of board) {
    for (const square of row) {
      if (square && square.color === color) {
        total += MATERIAL_VALUES[square.type] || 0;
      }
    }
  }
  return total;
}

/**
 * Convert legal move to BucketedCandidate with default values
 */
function legalToCandidate(m: Move): BucketedCandidate {
  return {
    move: m.from + m.to + (m.promotion || ''),
    from: m.from,
    to: m.to,
    isCapture: !!m.captured,
    isCheck: m.san.includes('+') || m.san.includes('#'),
    materialDrop: 0,
    evalPlayerCp: 0,
    lossCp: 9999,
    quality: 'bad',
  };
}

export class CandidateSelector {
  private chess: Chess;

  constructor(private engine: ChessEngine) {
    this.chess = new Chess();
  }

  async selectMoves(
    fen: string,
    moves: string[],
    elo: number,
    playerColor: 'w' | 'b',
    allowBrilliant = false,
    showAlwaysBestMoveFirst = false
  ): Promise<SelectResult> {
    const totalStart = Date.now();
    const band = getEloBand(elo);

    // Build deterministic seed
    const seedString = `${fen}|${moves.join(',')}|${elo}|${playerColor}|${allowBrilliant ? 1 : 0}`;
    const rng = new SeededRNG(seedString);

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

    // Step 1: Light warmup + accuracy calculation
    const warmupStart = Date.now();
    let playerPerformance: SelectResult['playerPerformance'] | undefined;
    if (moves.length > 0) {
      playerPerformance = await this.warmupAndCalculateAccuracy(moves, playerColor);
    }
    const warmupTime = Date.now() - warmupStart;
    const analysisStart = Date.now();

    // Initialize chess position ONCE
    if (moves.length > 0) {
      this.chess.reset();
      for (const m of moves) {
        const f = m.slice(0, 2);
        const t = m.slice(2, 4);
        const p = m.length > 4 ? m[4].toLowerCase() : undefined;
        this.chess.move({ from: f, to: t, promotion: p });
      }
    } else {
      this.chess.load(fen);
    }

    // Get legal moves and compute K
    const legal = this.chess.moves({ verbose: true });
    const K = Math.min(3, legal.length);
    if (K === 0) {
      return {
        lines: [],
        bestMove: '',
        evaluation: 0,
        playerPerformance,
        timing: { warmup: warmupTime, analysis: Date.now() - analysisStart, total: Date.now() - totalStart },
      };
    }

    // Step 2: Get reference evaluation
    const positionCmd = moves.length > 0
      ? `position startpos moves ${moves.join(' ')}`
      : `position fen ${fen}`;

    const refResult = await this.engine.analyzeNodes(positionCmd, band.nodesMain);
    const currentFen = this.chess.fen();
    const sideToMove = currentFen.split(' ')[1] as 'w' | 'b';
    const bestEvalPlayerCp = toPlayerPov(refResult.evalCp, playerColor, sideToMove);
    const bestMove = refResult.bestMove;

    globalLogger.info('candidate_selector_reference', {
      bestMove,
      bestEvalPlayerCp,
      mate: refResult.mate,
    });

    // Step 3: Build candidates (12-16)
    let candidates = this.buildCandidates(legal, playerColor);

    // Enforce candidates ⊆ legal
    const legalSet = new Set(legal.map(m => m.from + m.to + (m.promotion || '')));
    candidates = candidates.filter(c => legalSet.has(c.move));
    if (candidates.length < K) {
      candidates = legal.map(legalToCandidate);
    }

    globalLogger.info('candidate_selector_candidates', {
      count: candidates.length,
      moves: candidates.map(c => c.move).join(', '),
    });

    // Step 4: Quick-eval each candidate
    for (const cand of candidates) {
      const from = cand.move.slice(0, 2);
      const to = cand.move.slice(2, 4);
      const promotion = cand.move.length > 4 ? cand.move[4].toLowerCase() : undefined;

      const moveRes = this.chess.move({ from, to, promotion });
      if (!moveRes) continue;

      const fenAfterMove = this.chess.fen();
      this.chess.undo();

      const evalResult = await this.engine.analyzeNodes(`position fen ${fenAfterMove}`, band.nodesCand);
      const newSideToMove = fenAfterMove.split(' ')[1] as 'w' | 'b';
      cand.evalPlayerCp = toPlayerPov(evalResult.evalCp, playerColor, newSideToMove);
      cand.lossCp = Math.max(0, bestEvalPlayerCp - cand.evalPlayerCp);
      cand.quality = assignQuality(cand.lossCp, band.qualityLossCp);
    }

    // Ensure best move is in candidates
    if (!candidates.some(c => c.move === bestMove)) {
      const bestLegal = legal.find(m => m.from + m.to + (m.promotion || '') === bestMove);
      if (bestLegal) {
        const bestCand = this.buildCandidateFromMove(bestLegal, playerColor);
        bestCand.evalPlayerCp = bestEvalPlayerCp;
        bestCand.lossCp = 0;
        bestCand.quality = 'excellent';
        candidates.push(bestCand);
      }
    }

    // Step 5: Soft window filter
    let accepted = candidates.filter(c => c.evalPlayerCp >= bestEvalPlayerCp - band.windowCp);
    if (accepted.length < K) {
      accepted = [...candidates].sort((a, b) => b.evalPlayerCp - a.evalPlayerCp);
    }

    // Filter out sacrifice moves if allowBrilliant is disabled
    if (!allowBrilliant) {
      const nonSacrifice = accepted.filter(c => c.materialDrop < 3);
      if (nonSacrifice.length >= K) {
        accepted = nonSacrifice;
      }
      // If not enough non-sacrifice moves, keep original accepted (fallback to guarantee K moves)
    }

    globalLogger.info('candidate_selector_accepted', {
      count: accepted.length,
      moves: accepted.map(c => `${c.move}(${c.quality}:${c.lossCp})`).join(', '),
    });

    // Step 6: Sample picks using quality buckets
    const pick1 = this.pickBucketed(accepted, band, rng, bestEvalPlayerCp) ?? this.bestByEval(accepted);
    if (!pick1) {
      // No candidates at all (should not happen with K >= 1)
      return {
        lines: legal.slice(0, K).map(m => ({ moves: [m.from + m.to + (m.promotion || '')], evaluation: 0 })),
        bestMove: bestMove,
        evaluation: bestEvalPlayerCp / 100,
        playerPerformance,
        timing: { warmup: warmupTime, analysis: Date.now() - analysisStart, total: Date.now() - totalStart },
      };
    }
    const slot1Quality = pick1.quality as PickQuality;

    const rem1 = accepted.filter(x => x.move !== pick1.move);
    const pick2 = K >= 2
      ? (this.pickBucketedWithSim(rem1, [pick1], band, rng, bestEvalPlayerCp, slot1Quality) ?? this.bestByEval(rem1))
      : undefined;

    const rem2 = rem1.filter(x => x.move !== pick2?.move);
    const pick3 = K >= 3
      ? (this.pickBucketedWithSim(rem2, pick2 ? [pick1, pick2] : [pick1], band, rng, bestEvalPlayerCp, slot1Quality) ?? this.bestByEval(rem2))
      : undefined;

    globalLogger.info('candidate_selector_sampled', {
      picks: [pick1, pick2, pick3].filter(Boolean).map(p => `${p!.move}(${p!.quality})`).join(', '),
    });

    // Step 7: Verify final moves
    const toVerify = [pick1, pick2, pick3].filter(Boolean) as BucketedCandidate[];
    const verified: BucketedCandidate[] = [];

    for (const candidate of toVerify) {
      const from = candidate.move.slice(0, 2);
      const to = candidate.move.slice(2, 4);
      const promotion = candidate.move.length > 4 ? candidate.move[4].toLowerCase() : undefined;

      const moveRes = this.chess.move({ from, to, promotion });
      if (!moveRes) continue;

      const fenAfterMove = this.chess.fen();
      this.chess.undo();

      const verifyResult = await this.engine.analyzeNodes(`position fen ${fenAfterMove}`, VERIFY_NODES);
      const newSideToMove = fenAfterMove.split(' ')[1] as 'w' | 'b';
      const verifyEvalPlayerCp = toPlayerPov(verifyResult.evalCp, playerColor, newSideToMove);
      const verifyLossCp = Math.max(0, bestEvalPlayerCp - verifyEvalPlayerCp);

      if (verifyEvalPlayerCp >= bestEvalPlayerCp - MAX_DROP_CP) {
        // Brilliant detection (post-verify)
        const isBrilliant = allowBrilliant && candidate.materialDrop >= 3 && verifyLossCp <= 30;
        verified.push({
          ...candidate,
          evalPlayerCp: verifyEvalPlayerCp,
          lossCp: verifyLossCp,
          quality: assignQuality(verifyLossCp, band.qualityLossCp),
          isBrilliant,
        });
      } else {
        globalLogger.info('candidate_selector_verify_rejected', {
          move: candidate.move,
          verifyEvalPlayerCp,
          bestEvalPlayerCp,
          drop: bestEvalPlayerCp - verifyEvalPlayerCp,
        });
      }
    }

    // Step 8: Final fill (GUARANTEE K moves)
    let result = [...verified];
    const acceptedRanked = [...accepted].sort((a, b) => b.evalPlayerCp - a.evalPlayerCp);

    // Fill from accepted
    for (const m of acceptedRanked) {
      if (result.length >= K) break;
      if (!result.some(x => x.move === m.move)) result.push(m);
    }

    // Last resort: fill from legal
    for (const m of legal) {
      if (result.length >= K) break;
      const uci = m.from + m.to + (m.promotion || '');
      if (!result.some(x => x.move === uci)) {
        result.push(legalToCandidate(m));
      }
    }

    // Debug: invariant check
    if (legal.length >= 3 && result.length < 3) {
      globalLogger.error('candidate_selector_invariant_broken', 'Returned fewer than 3 moves when legal >= 3', {
        legal: legal.length,
        candidates: candidates.length,
        accepted: accepted.length,
        result: result.length,
      });
    }

    result = result.slice(0, K);

    // Step 9: Reorder if showAlwaysBestMoveFirst
    if (showAlwaysBestMoveFirst) {
      const bestIdx = result.findIndex(m => m.move === bestMove);
      if (bestIdx > 0) {
        [result[0], result[bestIdx]] = [result[bestIdx], result[0]];
      }
    }

    // Build result lines
    const lines: PVLine[] = result.map(m => ({
      moves: [m.move],
      evaluation: m.evalPlayerCp / 100,
      mate: undefined,
    }));

    globalLogger.info('candidate_selector_result', {
      moves: result.map(x => `${x.move}(${x.quality}${x.isBrilliant ? '!' : ''})`).join(', '),
    });

    const analysisTime = Date.now() - analysisStart;
    const totalTime = Date.now() - totalStart;

    return {
      lines,
      bestMove: result[0]?.move || bestMove,
      evaluation: (result[0]?.evalPlayerCp || bestEvalPlayerCp) / 100,
      playerPerformance,
      timing: { warmup: warmupTime, analysis: analysisTime, total: totalTime },
    };
  }

  /**
   * Build candidate list from legal moves (12-16)
   */
  private buildCandidates(legal: Move[], playerColor: 'w' | 'b'): BucketedCandidate[] {
    const captures: Move[] = [];
    const checks: Move[] = [];
    const promotions: Move[] = [];
    const others: Move[] = [];

    for (const move of legal) {
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

    const candidates: BucketedCandidate[] = [];
    const seen = new Set<string>();

    const addMove = (move: Move) => {
      const uci = move.from + move.to + (move.promotion || '');
      if (!seen.has(uci)) {
        seen.add(uci);
        candidates.push(this.buildCandidateFromMove(move, playerColor));
      }
    };

    // Add in priority order (max 12 candidates for performance)
    captures.slice(0, 5).forEach(addMove);
    checks.slice(0, 3).forEach(addMove);
    promotions.forEach(addMove);
    others.slice(0, 6).forEach(addMove);

    return candidates.slice(0, 12);
  }

  /**
   * Build a BucketedCandidate from a Move, calculating materialDrop
   */
  private buildCandidateFromMove(move: Move, playerColor: 'w' | 'b'): BucketedCandidate {
    const uci = move.from + move.to + (move.promotion || '');

    // Calculate material drop
    const materialBefore = countMaterial(this.chess, playerColor);
    const moveRes = this.chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    const materialAfter = moveRes ? countMaterial(this.chess, playerColor) : materialBefore;
    if (moveRes) this.chess.undo();
    const materialDrop = Math.max(0, materialBefore - materialAfter);

    return {
      move: uci,
      from: move.from,
      to: move.to,
      isCapture: !!move.captured,
      isCheck: move.san.includes('+') || move.san.includes('#'),
      materialDrop,
      evalPlayerCp: 0,
      lossCp: 9999,
      quality: 'bad',
    };
  }

  /**
   * Pick from bucket using quality sampling
   */
  private pickBucketed(
    pool: BucketedCandidate[],
    band: EloBand,
    rng: SeededRNG,
    bestEvalPlayerCp: number
  ): BucketedCandidate | undefined {
    if (pool.length === 0) return undefined;

    let targetQuality = sampleQuality(band.qualityTargets, rng);

    // Try to find candidate in target quality bucket
    for (let attempts = 0; attempts < 4; attempts++) {
      const bucket = pool.filter(c => c.quality === targetQuality || (c.quality === 'bad' && targetQuality === 'inaccuracy'));
      if (bucket.length > 0) {
        return this.weightedPick(bucket, bestEvalPlayerCp, band.tempCp, rng);
      }
      targetQuality = degradeQuality(targetQuality);
    }

    // Fallback: any candidate
    return this.weightedPick(pool, bestEvalPlayerCp, band.tempCp, rng);
  }

  /**
   * Pick from bucket with similarity filter and quality clamping
   */
  private pickBucketedWithSim(
    pool: BucketedCandidate[],
    selected: BucketedCandidate[],
    band: EloBand,
    rng: SeededRNG,
    bestEvalPlayerCp: number,
    slot1Quality: PickQuality
  ): BucketedCandidate | undefined {
    if (pool.length === 0) return undefined;

    // Sample quality and clamp to slot1Quality
    let targetQuality = clampQuality(sampleQuality(band.qualityTargets, rng), slot1Quality);

    for (let attempts = 0; attempts < 4; attempts++) {
      // Filter by quality
      let bucket = pool.filter(c => c.quality === targetQuality || (c.quality === 'bad' && targetQuality === 'inaccuracy'));

      // Apply similarity filter (soft: allow if bucket would be empty)
      const filtered = bucket.filter(c => !selected.some(s => this.tooSimilar(c, s, false)));
      if (filtered.length > 0) {
        return this.weightedPick(filtered, bestEvalPlayerCp, band.tempCp, rng);
      }

      // Try without soft similarity rules
      const hardFiltered = bucket.filter(c => !selected.some(s => this.tooSimilar(c, s, true)));
      if (hardFiltered.length > 0) {
        return this.weightedPick(hardFiltered, bestEvalPlayerCp, band.tempCp, rng);
      }

      targetQuality = degradeQuality(targetQuality);
    }

    // Fallback: any from pool without hard similarity
    const fallback = pool.filter(c => !selected.some(s => this.tooSimilar(c, s, true)));
    if (fallback.length > 0) {
      return this.weightedPick(fallback, bestEvalPlayerCp, band.tempCp, rng);
    }

    return pool[0];
  }

  /**
   * Get best candidate by eval
   */
  private bestByEval(pool: BucketedCandidate[]): BucketedCandidate | undefined {
    if (pool.length === 0) return undefined;
    return pool.reduce((best, c) => c.evalPlayerCp > best.evalPlayerCp ? c : best);
  }

  /**
   * Weighted pick using temperature
   */
  private weightedPick(
    items: BucketedCandidate[],
    bestEvalPlayerCp: number,
    tempCp: number,
    rng: SeededRNG
  ): BucketedCandidate {
    const weights = items.map(c => ({
      item: c,
      weight: Math.exp((c.evalPlayerCp - bestEvalPlayerCp) / tempCp),
    }));

    const totalWeight = weights.reduce((sum, x) => sum + x.weight, 0);
    let r = rng.next() * totalWeight;
    for (const { item, weight } of weights) {
      r -= weight;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  /**
   * Check if two moves are too similar
   */
  private tooSimilar(a: BucketedCandidate, b: BucketedCandidate, hardOnly: boolean): boolean {
    // Hard rules - always applied
    if (a.from === b.from || a.to === b.to) return true;

    // Soft rules - only if not hardOnly
    if (!hardOnly) {
      if (a.isCapture && b.isCapture) return true;
      if (a.isCheck && b.isCheck) return true;
    }

    return false;
  }

  /**
   * Light warmup on last N plies + accuracy calculation
   */
  private async warmupAndCalculateAccuracy(
    moves: string[],
    playerColor: 'w' | 'b'
  ): Promise<{ accuracy: number; movesAnalyzed: number }> {
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
}
