/**
 * Play DNA — Client-side computation
 * Takes raw game data from the server and computes:
 * - Per-cadence aggregates (accuracy, piece DNA, phase balance, tempo)
 * - Style detection
 * - Anti-cheat checks with PASS/WARN/FAIL
 * - Human score
 */

// ─── Types ───

export interface GameRawData {
  gameId: string
  playerColor: 'white' | 'black'
  playerRating: number
  opponentName: string
  opponentRating: number
  result: 'W' | 'L' | 'D'
  timeControl: string
  publicPgn: string
  caps: Record<string, any>
  positions: Array<{
    color: string
    classificationName: string
    isPositionCritical: boolean
    difference: number
  }>
  bookPly: number
  whiteName: string
  blackName: string
}

export type TimeControlType = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'unknown'

export interface PieceAccuracy {
  piece: string
  label: string
  mean: number
  stddev: number | null
}

export interface PhaseAccuracy {
  phase: string
  label: string
  mean: number
  stddev: number | null
}

export interface AntiCheatCheck {
  status: 'PASS' | 'WARN' | 'FAIL'
  label: string
  value: string
  threshold: string
  detail: string
}

export interface CadenceProfile {
  tcType: TimeControlType
  tcLabel: string
  gamesCount: number
  avgRating: number
  avgAccuracy: number | null
  accStdDev: number | null
  expected: number
  delta: number | null
  style: string
  pieces: PieceAccuracy[]
  pieceVariance: number | null
  strongestPiece: PieceAccuracy | null
  weakestPiece: PieceAccuracy | null
  phases: PhaseAccuracy[]
  phaseVariance: number | null
  bestPhase: PhaseAccuracy | null
  worstPhase: PhaseAccuracy | null
  classifications: Record<string, number>
  totalMoves: number
  bestMoveRate: number
  blunderRate: number
  tempo: {
    avgThinkTime: number | null
    thinkStdDev: number | null
    thinkByClass: Record<string, { avg: number; count: number }>
    criticalAvg: number | null
    calmAvg: number | null
    thinkReflexRatio: number | null
    timeCV: number | null
    blunderAvgTime: number | null
    blunderPattern: string
  }
  antiCheat: {
    checks: AntiCheatCheck[]
    humanScore: number
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
    passCount: number
    warnCount: number
    failCount: number
  }
  games: Array<{
    gameId: string
    accuracy: number | null
    delta: number | null
    result: string
    opponentName: string
    opponentRating: number
    opening: number | null
    middlegame: number | null
    endgame: number | null
  }>
}

export interface ProfileAnalysisResult {
  username: string
  gamesCount: number
  avgRating: number
  wins: number
  losses: number
  draws: number
  cadences: CadenceProfile[]
  crossCadence: {
    avgDelta: number | null
    deltaStdDev: number | null
    isMultiTc: boolean
  } | null
}

// ─── Constants ───

const NORMS: Record<string, Record<number, number>> = {
  bullet:    { 800: 50, 1000: 55, 1200: 60, 1400: 65, 1600: 70, 1800: 75, 2000: 80, 2200: 85, 2400: 90 },
  blitz:     { 800: 55, 1000: 60, 1200: 65, 1400: 70, 1600: 75, 1800: 80, 2000: 85, 2200: 88, 2400: 92 },
  rapid:     { 800: 60, 1000: 65, 1200: 70, 1400: 75, 1600: 80, 1800: 85, 2000: 88, 2200: 91, 2400: 94 },
  classical: { 800: 60, 1000: 65, 1200: 70, 1400: 75, 1600: 80, 1800: 85, 2000: 88, 2200: 91, 2400: 94 },
}

const THRESHOLDS: Record<string, { accStdDev: number; pieceVar: number; phaseVar: number; thinkRatio: number; timeCV: number; bestMoveRate: number; deltaFlag: number }> = {
  bullet:    { accStdDev: 8,  pieceVar: 8,  phaseVar: 5, thinkRatio: 1.0, timeCV: 0.4,  bestMoveRate: 55, deltaFlag: 12 },
  blitz:     { accStdDev: 6,  pieceVar: 6,  phaseVar: 4, thinkRatio: 1.5, timeCV: 0.35, bestMoveRate: 65, deltaFlag: 10 },
  rapid:     { accStdDev: 5,  pieceVar: 5,  phaseVar: 3, thinkRatio: 2.0, timeCV: 0.3,  bestMoveRate: 70, deltaFlag: 8 },
  classical: { accStdDev: 5,  pieceVar: 5,  phaseVar: 3, thinkRatio: 2.0, timeCV: 0.3,  bestMoveRate: 70, deltaFlag: 8 },
}

const PIECE_KEYS = ['K', 'Q', 'R', 'B', 'N', 'P'] as const
const PIECE_LABELS: Record<string, string> = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' }
const PHASE_KEYS = ['gp0', 'gp1', 'gp2'] as const
const PHASE_LABELS: Record<string, string> = { gp0: 'Opening', gp1: 'Middlegame', gp2: 'Endgame' }
const CLS_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder']

// ─── Helpers ───

function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function stddev(arr: number[]): number | null {
  if (arr.length < 2) return null
  const m = mean(arr)!
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1))
}

export function classifyTimeControl(tc: string): TimeControlType {
  if (!tc) return 'unknown'
  const parts = tc.split('+')
  const base = parseInt(parts[0])
  const inc = parseInt(parts[1] || '0')
  const total = base + inc * 40
  if (total < 180) return 'bullet'
  if (total < 600) return 'blitz'
  if (total < 1800) return 'rapid'
  return 'classical'
}

function timeControlLabel(tc: TimeControlType): string {
  return { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', unknown: 'Unknown' }[tc]
}

function getExpectedAccuracy(rating: number, tcType: string): number {
  const norms = NORMS[tcType] || NORMS.blitz
  const brackets = Object.keys(norms).map(Number).sort((a, b) => a - b)
  if (rating <= brackets[0]) return norms[brackets[0]]
  if (rating >= brackets[brackets.length - 1]) return norms[brackets[brackets.length - 1]]
  for (let i = 0; i < brackets.length - 1; i++) {
    if (rating >= brackets[i] && rating < brackets[i + 1]) {
      const pct = (rating - brackets[i]) / (brackets[i + 1] - brackets[i])
      return norms[brackets[i]] + pct * (norms[brackets[i + 1]] - norms[brackets[i]])
    }
  }
  return 70
}

function normalizeAccuracy(acc: number | null, rating: number, tcType: string): number | null {
  if (acc == null) return null
  return acc - getExpectedAccuracy(rating, tcType)
}

function extractClockTimes(pgn: string): { whiteTimes: number[]; blackTimes: number[] } {
  const whiteTimes: number[] = []
  const blackTimes: number[] = []
  const clkRegex = /\{?\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]\}?/g
  let match: RegExpExecArray | null
  let moveIdx = 0
  while ((match = clkRegex.exec(pgn)) !== null) {
    const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3])
    if (moveIdx % 2 === 0) whiteTimes.push(seconds)
    else blackTimes.push(seconds)
    moveIdx++
  }
  return { whiteTimes, blackTimes }
}

function calcThinkTimes(clockTimes: number[], increment: number): number[] {
  const thinkTimes: number[] = []
  for (let i = 1; i < clockTimes.length; i++) {
    thinkTimes.push(Math.max(0, clockTimes[i - 1] - clockTimes[i] + increment))
  }
  return thinkTimes
}

function getThresholds(tcType: string) {
  return THRESHOLDS[tcType] || THRESHOLDS.blitz
}

// ─── Main computation ───

export function computePlayDNA(gamesData: GameRawData[], username: string): ProfileAnalysisResult {
  const avgRating = mean(gamesData.map(g => g.playerRating).filter(Boolean)) || 0
  const wins = gamesData.filter(g => g.result === 'W').length
  const losses = gamesData.filter(g => g.result === 'L').length
  const draws = gamesData.filter(g => g.result === 'D').length

  // Group by time control
  const byTc = new Map<TimeControlType, GameRawData[]>()
  for (const g of gamesData) {
    const tc = classifyTimeControl(g.timeControl)
    if (!byTc.has(tc)) byTc.set(tc, [])
    byTc.get(tc)!.push(g)
  }

  // Build per-cadence profiles
  const cadences: CadenceProfile[] = []
  for (const [tcType, games] of byTc) {
    cadences.push(buildCadenceProfile(tcType, games, username))
  }

  // Cross-cadence
  const normalizedDeltas = gamesData
    .map(g => normalizeAccuracy(g.caps?.[g.playerColor]?.all, g.playerRating, classifyTimeControl(g.timeControl)))
    .filter((d): d is number => d != null)
  const isMultiTc = byTc.size > 1

  return {
    username,
    gamesCount: gamesData.length,
    avgRating: Math.round(avgRating),
    wins, losses, draws,
    cadences,
    crossCadence: isMultiTc ? {
      avgDelta: mean(normalizedDeltas),
      deltaStdDev: stddev(normalizedDeltas),
      isMultiTc: true,
    } : null,
  }
}

function buildCadenceProfile(tcType: TimeControlType, games: GameRawData[], username: string): CadenceProfile {
  const t = getThresholds(tcType)
  const tcLabel = timeControlLabel(tcType)

  // Accuracy
  const accs = games.map(g => g.caps?.[g.playerColor]?.all as number | undefined).filter((a): a is number => a != null)
  const avgRat = mean(games.map(g => g.playerRating).filter(Boolean)) || 0
  const expected = getExpectedAccuracy(avgRat, tcType)
  const avgAcc = mean(accs)
  const accStd = stddev(accs)
  const delta = avgAcc != null ? avgAcc - expected : null

  // Pieces
  const pieces: PieceAccuracy[] = []
  for (const p of PIECE_KEYS) {
    const vals = games.map(g => g.caps?.[g.playerColor]?.[p] as number | undefined).filter((v): v is number => v != null && v > 0)
    if (vals.length > 0) pieces.push({ piece: p, label: PIECE_LABELS[p], mean: mean(vals)!, stddev: stddev(vals) })
  }
  pieces.sort((a, b) => b.mean - a.mean)
  const pieceVar = stddev(pieces.map(p => p.mean))
  const strongestPiece = pieces[0] || null
  const weakestPiece = pieces[pieces.length - 1] || null

  // Phases
  const phases: PhaseAccuracy[] = []
  for (const ph of PHASE_KEYS) {
    const vals = games.map(g => g.caps?.[g.playerColor]?.[ph] as number | undefined).filter((v): v is number => v != null)
    if (vals.length > 0) phases.push({ phase: ph, label: PHASE_LABELS[ph], mean: mean(vals)!, stddev: stddev(vals) })
  }
  const phaseVar = stddev(phases.map(p => p.mean))
  const bestPhase = phases.length > 0 ? phases.reduce((a, b) => a.mean > b.mean ? a : b) : null
  const worstPhase = phases.length > 0 ? phases.reduce((a, b) => a.mean < b.mean ? a : b) : null

  // Classifications
  const cls: Record<string, number> = {}
  let totalMoves = 0
  for (const g of games) {
    for (const pos of g.positions) {
      if (pos.color !== g.playerColor || !pos.classificationName) continue
      cls[pos.classificationName] = (cls[pos.classificationName] || 0) + 1
      totalMoves++
    }
  }
  const nonBookTotal = totalMoves - (cls.book || 0)
  const bestMoveRate = nonBookTotal > 0 ? ((cls.best || 0) / nonBookTotal) * 100 : 0
  const blunderRate = totalMoves > 0 ? (((cls.blunder || 0) + (cls.miss || 0)) / totalMoves) * 100 : 0

  // Tempo
  const allThinkTimes: number[] = []
  const criticalTimes: number[] = []
  const calmTimes: number[] = []
  const thinkByClassMap: Record<string, number[]> = {}

  for (const g of games) {
    const increment = parseInt((g.timeControl || '').split('+')[1] || '0')
    const clocks = extractClockTimes(g.publicPgn)
    const playerClocks = g.playerColor === 'white' ? clocks.whiteTimes : clocks.blackTimes
    const thinkTimes = calcThinkTimes(playerClocks, increment)
    allThinkTimes.push(...thinkTimes)

    let posIdx = 0
    for (const pos of g.positions) {
      if (pos.color !== g.playerColor) continue
      const tt = thinkTimes[posIdx] ?? null
      if (tt != null) {
        const cn = pos.classificationName
        if (cn) {
          if (!thinkByClassMap[cn]) thinkByClassMap[cn] = []
          thinkByClassMap[cn].push(tt)
        }
        if (cn !== 'book') {
          if (pos.isPositionCritical) criticalTimes.push(tt)
          else calmTimes.push(tt)
        }
      }
      posIdx++
    }
  }

  const avgThinkTime = mean(allThinkTimes)
  const thinkStdDev = stddev(allThinkTimes)
  const criticalAvg = mean(criticalTimes)
  const calmAvg = mean(calmTimes)
  const thinkReflexRatio = criticalAvg != null && calmAvg != null && calmAvg > 0 ? criticalAvg / calmAvg : null
  const timeCV = thinkStdDev != null && avgThinkTime != null && avgThinkTime > 0 ? thinkStdDev / avgThinkTime : null

  const thinkByClass: Record<string, { avg: number; count: number }> = {}
  for (const [c, times] of Object.entries(thinkByClassMap)) {
    if (times.length > 0) thinkByClass[c] = { avg: mean(times)!, count: times.length }
  }

  const blunderTimes = [...(thinkByClassMap.blunder || []), ...(thinkByClassMap.miss || [])]
  const blunderAvgTime = mean(blunderTimes)
  let blunderPattern = 'not enough data'
  if (blunderAvgTime != null && avgThinkTime != null) {
    if (blunderAvgTime < avgThinkTime * 0.6) blunderPattern = 'blunders when rushing'
    else if (blunderAvgTime > avgThinkTime * 1.4) blunderPattern = 'blunders when overthinking'
    else blunderPattern = 'no clear pattern'
  }

  // Style detection
  const op = phases.find(p => p.phase === 'gp0')?.mean
  const mid = phases.find(p => p.phase === 'gp1')?.mean
  const end = phases.find(p => p.phase === 'gp2')?.mean
  let style = 'All-rounder'
  if (op != null && mid != null) {
    if (op > mid + 10 && (!end || op > end + 10)) style = 'Opening specialist'
    else if (end != null && end > mid + 10 && end > op + 10) style = 'Endgame grinder'
    else if (mid > op + 10) style = 'Tactical middlegame player'
  }
  const goodPct = nonBookTotal > 0 ? ((cls.good || 0) / nonBookTotal) * 100 : 0
  if (bestMoveRate > 45 && blunderRate > 3) style += ' / Risk-taker'
  else if (goodPct > 15 && blunderRate < 2) style += ' / Solid positional'

  // Anti-cheat checks
  const checks: AntiCheatCheck[] = []
  const deltaAbs = delta ?? 0

  // 1. Accuracy delta
  if (deltaAbs > t.deltaFlag + 5) checks.push({ status: 'FAIL', label: 'accuracy_delta', value: `+${deltaAbs.toFixed(1)}%`, threshold: `>${t.deltaFlag + 5}`, detail: 'way above expected for rating/cadence' })
  else if (deltaAbs > t.deltaFlag) checks.push({ status: 'WARN', label: 'accuracy_delta', value: `+${deltaAbs.toFixed(1)}%`, threshold: `>${t.deltaFlag}`, detail: 'above expected for rating/cadence' })
  else checks.push({ status: 'PASS', label: 'accuracy_delta', value: `${deltaAbs >= 0 ? '+' : ''}${deltaAbs.toFixed(1)}%`, threshold: `<${t.deltaFlag}`, detail: 'within expected range' })

  // 2. Consistency
  if (accStd != null && accs.length >= 3) {
    if (accStd < t.accStdDev * 0.6) checks.push({ status: 'FAIL', label: 'accuracy_consistency', value: `stddev ${accStd.toFixed(1)}`, threshold: `<${(t.accStdDev * 0.6).toFixed(1)}`, detail: 'extremely consistent' })
    else if (accStd < t.accStdDev) checks.push({ status: 'WARN', label: 'accuracy_consistency', value: `stddev ${accStd.toFixed(1)}`, threshold: `<${t.accStdDev}`, detail: 'too consistent for cadence' })
    else checks.push({ status: 'PASS', label: 'accuracy_consistency', value: `stddev ${accStd.toFixed(1)}`, threshold: `>${t.accStdDev}`, detail: 'normal human variance' })
  }

  // 3. Best move rate
  if (bestMoveRate > t.bestMoveRate + 10) checks.push({ status: 'FAIL', label: 'best_move_rate', value: `${bestMoveRate.toFixed(1)}%`, threshold: `>${t.bestMoveRate + 10}%`, detail: 'engine-level' })
  else if (bestMoveRate > t.bestMoveRate) checks.push({ status: 'WARN', label: 'best_move_rate', value: `${bestMoveRate.toFixed(1)}%`, threshold: `>${t.bestMoveRate}%`, detail: 'elevated' })
  else checks.push({ status: 'PASS', label: 'best_move_rate', value: `${bestMoveRate.toFixed(1)}%`, threshold: `<${t.bestMoveRate}%`, detail: 'normal' })

  // 4. Piece uniformity
  if (pieceVar != null) {
    if (pieceVar < t.pieceVar * 0.6) checks.push({ status: 'FAIL', label: 'piece_uniformity', value: `var ${pieceVar.toFixed(1)}`, threshold: `<${(t.pieceVar * 0.6).toFixed(1)}`, detail: 'all pieces same accuracy' })
    else if (pieceVar < t.pieceVar) checks.push({ status: 'WARN', label: 'piece_uniformity', value: `var ${pieceVar.toFixed(1)}`, threshold: `<${t.pieceVar}`, detail: 'pieces too uniform' })
    else checks.push({ status: 'PASS', label: 'piece_uniformity', value: `var ${pieceVar.toFixed(1)}`, threshold: `>${t.pieceVar}`, detail: 'human-like weaknesses' })
  }

  // 5. Phase uniformity
  if (phaseVar != null) {
    if (phaseVar < t.phaseVar * 0.5) checks.push({ status: 'FAIL', label: 'phase_uniformity', value: `var ${phaseVar.toFixed(1)}`, threshold: `<${(t.phaseVar * 0.5).toFixed(1)}`, detail: 'same accuracy all phases' })
    else if (phaseVar < t.phaseVar) checks.push({ status: 'WARN', label: 'phase_uniformity', value: `var ${phaseVar.toFixed(1)}`, threshold: `<${t.phaseVar}`, detail: 'phases too balanced' })
    else checks.push({ status: 'PASS', label: 'phase_uniformity', value: `var ${phaseVar.toFixed(1)}`, threshold: `>${t.phaseVar}`, detail: 'normal phase variation' })
  }

  // 6. Think/Reflex ratio
  if (thinkReflexRatio != null) {
    if (thinkReflexRatio < t.thinkRatio * 0.5) checks.push({ status: 'FAIL', label: 'think_reflex_ratio', value: `${thinkReflexRatio.toFixed(2)}x`, threshold: `<${(t.thinkRatio * 0.5).toFixed(1)}x`, detail: 'thinks LESS on hard moves' })
    else if (thinkReflexRatio < t.thinkRatio) checks.push({ status: 'WARN', label: 'think_reflex_ratio', value: `${thinkReflexRatio.toFixed(2)}x`, threshold: `<${t.thinkRatio}x`, detail: 'not enough differentiation' })
    else checks.push({ status: 'PASS', label: 'think_reflex_ratio', value: `${thinkReflexRatio.toFixed(2)}x`, threshold: `>${t.thinkRatio}x`, detail: 'thinks more on hard positions' })
  }

  // 7. Time CV
  if (timeCV != null) {
    if (timeCV < t.timeCV * 0.6) checks.push({ status: 'FAIL', label: 'time_rhythm', value: `CV ${timeCV.toFixed(2)}`, threshold: `<${(t.timeCV * 0.6).toFixed(2)}`, detail: 'robotic tempo' })
    else if (timeCV < t.timeCV) checks.push({ status: 'WARN', label: 'time_rhythm', value: `CV ${timeCV.toFixed(2)}`, threshold: `<${t.timeCV}`, detail: 'low time variation' })
    else checks.push({ status: 'PASS', label: 'time_rhythm', value: `CV ${timeCV.toFixed(2)}`, threshold: `>${t.timeCV}`, detail: 'natural rhythm' })
  }

  // 8. Has mistakes
  const mistakeCount = (cls.blunder || 0) + (cls.miss || 0) + (cls.mistake || 0)
  if (mistakeCount === 0 && totalMoves > 30) checks.push({ status: 'WARN', label: 'has_mistakes', value: `0 in ${totalMoves} moves`, threshold: '>0', detail: 'zero mistakes is unusual' })
  else checks.push({ status: 'PASS', label: 'has_mistakes', value: `${mistakeCount} mistakes`, threshold: '>0', detail: 'humans make mistakes' })

  const passCount = checks.filter(c => c.status === 'PASS').length
  const warnCount = checks.filter(c => c.status === 'WARN').length
  const failCount = checks.filter(c => c.status === 'FAIL').length
  const score = passCount * 2 - warnCount - failCount * 3
  const maxScore = checks.length * 2
  const humanScore = Math.max(0, Math.min(10, Math.round((score / maxScore) * 10)))
  const riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = humanScore >= 7 ? 'LOW' : humanScore >= 4 ? 'MEDIUM' : 'HIGH'

  // Per-game data for the trend chart
  const gamesList = games.map(g => ({
    gameId: g.gameId,
    accuracy: g.caps?.[g.playerColor]?.all as number | null ?? null,
    delta: normalizeAccuracy(g.caps?.[g.playerColor]?.all, g.playerRating, tcType),
    result: g.result,
    opponentName: g.opponentName,
    opponentRating: g.opponentRating,
    opening: (g.caps?.[g.playerColor]?.gp0 as number | null) ?? null,
    middlegame: (g.caps?.[g.playerColor]?.gp1 as number | null) ?? null,
    endgame: (g.caps?.[g.playerColor]?.gp2 as number | null) ?? null,
  }))

  return {
    tcType, tcLabel, gamesCount: games.length, avgRating: Math.round(avgRat),
    avgAccuracy: avgAcc, accStdDev: accStd, expected, delta,
    style,
    pieces, pieceVariance: pieceVar, strongestPiece, weakestPiece,
    phases, phaseVariance: phaseVar, bestPhase, worstPhase,
    classifications: cls, totalMoves, bestMoveRate, blunderRate,
    tempo: {
      avgThinkTime, thinkStdDev, thinkByClass,
      criticalAvg, calmAvg, thinkReflexRatio, timeCV,
      blunderAvgTime, blunderPattern,
    },
    antiCheat: { checks, humanScore, riskLevel, passCount, warnCount, failCount },
    games: gamesList,
  }
}
