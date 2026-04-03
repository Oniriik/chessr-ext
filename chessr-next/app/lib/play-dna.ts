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

export type FlagStatus = 'clean' | 'suspicious' | 'flagged'

export interface ProfileFlag {
  id: string
  label: string
  status: FlagStatus
  value: string
  detail: string
  weight: number // multiplier for scoring (default 1, account age can be higher)
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
  flags: ProfileFlag[]
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
    classifications: Record<string, number>
    totalMoves: number
    pieces: { piece: string; label: string; accuracy: number | null }[]
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

export function computePlayDNA(gamesData: GameRawData[], username: string, opts?: { accountCreatedAt?: number | null }): ProfileAnalysisResult {
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
    cadences.push(buildCadenceProfile(tcType, games, username, opts?.accountCreatedAt))
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

// ─── Style wording system ───

// Deterministic seed from stats — same stats always produce the same index
function statSeed(vals: (number | null | undefined)[]): number {
  let h = 0
  for (const v of vals) {
    const n = v != null ? Math.round(v * 100) : 0
    h = ((h << 5) - h + n) | 0
  }
  return Math.abs(h)
}

function pickFrom(arr: string[], seed: number): string {
  return arr[seed % arr.length]
}

// Tiered wordings: mild (<70%), strong (70-85%), elite (>85%) based on dominant phase accuracy
// 10 wordings per tier × 3 tiers = 30 per category

const STYLE_OPENING: Record<string, string[]> = {
  mild: [
    'Opening Dabbler', 'Theory Curious', 'Opening Leaner',
    'Slight Book Preference', 'Opening Inclined', 'Theory Taster',
    'First-Move Thinker', 'Casual Theorist', 'Opening Aware', 'Prep Curious',
  ],
  strong: [
    'Opening Specialist', 'Theory Expert', 'Book Shark',
    'Repertoire Master', 'Opening Tactician', 'Prep Enthusiast',
    'Opening Strategist', 'Theory Devotee', 'Opening Scholar', 'Line Specialist',
  ],
  elite: [
    'Prep Assassin', 'Opening Wizard', 'Theory Savant',
    'Preparation Sniper', 'Opening Prodigy', 'Prep Machine',
    'First-Move Architect', 'Opening Connoisseur', 'Novelty Hunter', 'Book Surgeon',
  ],
}

const STYLE_MIDDLEGAME: Record<string, string[]> = {
  mild: [
    'Middlegame Leaner', 'Tactical Thinker', 'Combat Curious',
    'Slight Tactical Edge', 'Middlegame Inclined', 'Position Taster',
    'Combination Aware', 'Casual Tactician', 'Board Thinker', 'Attack Curious',
  ],
  strong: [
    'Tactical Brawler', 'Middlegame Specialist', 'Combination Artist',
    'Board Dominator', 'Tactical Sniper', 'Complication Seeker',
    'Attack Master', 'Piece Coordinator', 'Pressure Builder', 'Initiative Seeker',
  ],
  elite: [
    'Tactical Wizard', 'Middlegame Monster', 'Chaos Agent',
    'Tactical Genius', 'Board Commander', 'Middlegame Predator',
    'Piece Magician', 'Tactical Storm', 'Middlegame Surgeon', 'Tactical Maverick',
  ],
}

const STYLE_ENDGAME: Record<string, string[]> = {
  mild: [
    'Endgame Leaner', 'Late-Game Curious', 'Technique Taster',
    'Slight Endgame Edge', 'Endgame Inclined', 'Patient Leaner',
    'Conversion Curious', 'Casual Grinder', 'Endgame Thinker', 'Pawn Aware',
  ],
  strong: [
    'Endgame Grinder', 'Late-Game Specialist', 'Endgame Technician',
    'Conversion Expert', 'Technique Master', 'Pawn Whisperer',
    'Squeeze Master', 'Endgame Artisan', 'Material Converter', 'Patience Master',
  ],
  elite: [
    'Endgame Machine', 'Endgame Virtuoso', 'Fortress Breaker',
    'Zugzwang Dealer', 'Endgame Surgeon', 'Endgame Prophet',
    'King Activator', 'Endgame Sage', 'Technical Wizard', 'Simplification Artist',
  ],
}

const STYLE_ALLROUND: Record<string, string[]> = {
  mild: [
    'Developing Player', 'Balanced Learner', 'Steady Beginner',
    'Growing All-Rounder', 'Flexible Learner', 'Adaptive Newcomer',
    'Even-Keeled Player', 'Phase Explorer', 'Balanced Thinker', 'Budding Generalist',
  ],
  strong: [
    'All-Rounder', 'Complete Player', 'Versatile Fighter',
    'Balanced Strategist', 'Flexible Fighter', 'Full-Spectrum Player',
    'Versatile Competitor', 'Adaptable Player', 'Consistent Performer', 'Steady Operator',
  ],
  elite: [
    'Universal Soldier', 'Swiss Army Knight', 'Equilibrium Master',
    'Multi-Phase Master', 'Harmonious Player', 'Complete Competitor',
    'Calibrated Player', 'Phase Equalizer', 'Versatile Mind', 'Balanced Force',
  ],
}

const MOD_RISK: Record<string, string[]> = {
  mild: [
    'Slight Gambler', 'Occasional Risk-Taker', 'Sometimes Bold',
    'Edge Curious', 'Mild Daredevil', 'Spark of Chaos',
    'Opportunistic', 'Casual Aggressor', 'Slight Wild Card', 'Sometimes Sharp',
  ],
  strong: [
    'Risk-Taker', 'Aggressive Player', 'Double-Edged Specialist',
    'Gambit Player', 'Bold Operator', 'Sword Fighter',
    'Sharp Calculator', 'Explosive Player', 'Fearless Attacker', 'Thrill Seeker',
  ],
  elite: [
    'Berserker', 'Fire on Board', 'Controlled Madness',
    'Volatile Genius', 'All-In Specialist', 'Unhinged Talent',
    'Brilliant or Blunder', 'Danger Zone Player', 'Chaos Architect', 'Playing with Fire',
  ],
}

const MOD_SOLID: Record<string, string[]> = {
  mild: [
    'Slightly Careful', 'Cautious Leaner', 'Measured Player',
    'Risk-Averse', 'Careful Thinker', 'Steady Mover',
    'Conservative Lean', 'Mild Grinder', 'Low-Risk Player', 'Quiet Approach',
  ],
  strong: [
    'Solid Positional', 'Rock Solid', 'Patient Strategist',
    'Iron Defense', 'Quiet Killer', 'Strategic Thinker',
    'Methodical Player', 'Controlled Player', 'Precision Player', 'Clean Technician',
  ],
  elite: [
    'Fortress Builder', 'Prophylaxis Master', 'Ice-Cold Calculator',
    'Positional Surgeon', 'Calm Under Pressure', 'Slow Constrictor',
    'Defensive Wall', 'Quiet Assassin', 'Mistake Avoider', 'Calculated Patience',
  ],
}

function getTier(accuracy: number): string {
  if (accuracy >= 85) return 'elite'
  if (accuracy >= 70) return 'strong'
  return 'mild'
}

// For modifiers: tier based on how extreme the modifier stats are
function getModTier(bestMoveRate: number, blunderRate: number, goodPct: number): string {
  // Risk: higher bestMove + higher blunder = more extreme
  if (bestMoveRate > 55 && blunderRate > 5) return 'elite'
  if (bestMoveRate > 50 || blunderRate > 4) return 'strong'
  return 'mild'
}

function getSolidTier(goodPct: number, blunderRate: number): string {
  if (goodPct > 25 && blunderRate < 1) return 'elite'
  if (goodPct > 20 || blunderRate < 1.5) return 'strong'
  return 'mild'
}

function generateStyle(stats: {
  op: number | undefined; mid: number | undefined; end: number | undefined
  bestMoveRate: number; blunderRate: number; goodPct: number
  avgAcc: number | null; accStd: number | null; avgRating: number; totalMoves: number
}): string {
  const { op, mid, end, bestMoveRate, blunderRate, goodPct, avgAcc, accStd, avgRating, totalMoves } = stats
  const seed = statSeed([op, mid, end, avgAcc, accStd, avgRating, totalMoves])

  // Phase category + tier based on dominant phase accuracy
  let phase: string
  if (op != null && mid != null) {
    if (op > mid + 10 && (!end || op > end + 10)) {
      phase = pickFrom(STYLE_OPENING[getTier(op)], seed)
    } else if (end != null && end > mid + 10 && end > op + 10) {
      phase = pickFrom(STYLE_ENDGAME[getTier(end)], seed)
    } else if (mid > op + 10) {
      phase = pickFrom(STYLE_MIDDLEGAME[getTier(mid)], seed)
    } else {
      // All-round: tier based on overall accuracy
      const overall = avgAcc ?? ((op + mid + (end ?? mid)) / (end != null ? 3 : 2))
      phase = pickFrom(STYLE_ALLROUND[getTier(overall)], seed)
    }
  } else {
    phase = pickFrom(STYLE_ALLROUND[getTier(avgAcc ?? 50)], seed)
  }

  // Modifier with its own tier
  const modSeed = statSeed([bestMoveRate, blunderRate, goodPct, avgAcc])
  if (bestMoveRate > 45 && blunderRate > 3) {
    const tier = getModTier(bestMoveRate, blunderRate, goodPct)
    return `${phase} · ${pickFrom(MOD_RISK[tier], modSeed)}`
  }
  if (goodPct > 15 && blunderRate < 2) {
    const tier = getSolidTier(goodPct, blunderRate)
    return `${phase} · ${pickFrom(MOD_SOLID[tier], modSeed)}`
  }

  return phase
}

function buildCadenceProfile(tcType: TimeControlType, games: GameRawData[], username: string, accountCreatedAt?: number | null): CadenceProfile {
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
  const goodPct = nonBookTotal > 0 ? ((cls.good || 0) / nonBookTotal) * 100 : 0
  const style = generateStyle({ op, mid, end, bestMoveRate, blunderRate, goodPct, avgAcc, accStd, avgRating: avgRat, totalMoves })

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

  // 4. Piece uniformity — scale by elo: low elo has naturally higher piece variance, GMs are more uniform
  if (pieceVar != null) {
    const pieceEloFactor = avgRat < 1000 ? 1.8 : avgRat < 1500 ? 1.4 : avgRat < 2000 ? 1.0 : avgRat < 2500 ? 0.7 : 0.5
    const adjPieceVar = t.pieceVar * pieceEloFactor
    if (pieceVar < adjPieceVar * 0.6) checks.push({ status: 'FAIL', label: 'piece_uniformity', value: `var ${pieceVar.toFixed(1)}`, threshold: `<${(adjPieceVar * 0.6).toFixed(1)}`, detail: 'all pieces same accuracy' })
    else if (pieceVar < adjPieceVar) checks.push({ status: 'WARN', label: 'piece_uniformity', value: `var ${pieceVar.toFixed(1)}`, threshold: `<${adjPieceVar.toFixed(1)}`, detail: 'pieces too uniform' })
    else checks.push({ status: 'PASS', label: 'piece_uniformity', value: `var ${pieceVar.toFixed(1)}`, threshold: `>${adjPieceVar.toFixed(1)}`, detail: 'human-like weaknesses' })
  }

  // 5. Phase uniformity — scale by elo same as piece
  if (phaseVar != null) {
    const phaseEloFactor = avgRat < 1000 ? 1.8 : avgRat < 1500 ? 1.4 : avgRat < 2000 ? 1.0 : avgRat < 2500 ? 0.7 : 0.5
    const adjPhaseVar = t.phaseVar * phaseEloFactor
    if (phaseVar < adjPhaseVar * 0.5) checks.push({ status: 'FAIL', label: 'phase_uniformity', value: `var ${phaseVar.toFixed(1)}`, threshold: `<${(adjPhaseVar * 0.5).toFixed(1)}`, detail: 'same accuracy all phases' })
    else if (phaseVar < adjPhaseVar) checks.push({ status: 'WARN', label: 'phase_uniformity', value: `var ${phaseVar.toFixed(1)}`, threshold: `<${adjPhaseVar.toFixed(1)}`, detail: 'phases too balanced' })
    else checks.push({ status: 'PASS', label: 'phase_uniformity', value: `var ${phaseVar.toFixed(1)}`, threshold: `>${adjPhaseVar.toFixed(1)}`, detail: 'normal phase variation' })
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

  // Per-game data
  const gamesList = games.map(g => {
    const playerCaps = g.caps?.[g.playerColor]
    // Per-game move classifications
    const gameCls: Record<string, number> = {}
    let gameMoves = 0
    for (const pos of g.positions) {
      if (pos.color === g.playerColor) {
        const cn = pos.classificationName?.toLowerCase()
        if (cn) { gameCls[cn] = (gameCls[cn] || 0) + 1; gameMoves++ }
      }
    }
    // Per-game piece accuracy
    const gamePieces = PIECE_KEYS.map(p => ({
      piece: p,
      label: PIECE_LABELS[p],
      accuracy: (playerCaps?.[p] as number | null) ?? null,
    }))

    return {
      gameId: g.gameId,
      accuracy: playerCaps?.all as number | null ?? null,
      delta: normalizeAccuracy(playerCaps?.all, g.playerRating, tcType),
      result: g.result,
      opponentName: g.opponentName,
      opponentRating: g.opponentRating,
      opening: (playerCaps?.gp0 as number | null) ?? null,
      middlegame: (playerCaps?.gp1 as number | null) ?? null,
      endgame: (playerCaps?.gp2 as number | null) ?? null,
      classifications: gameCls,
      totalMoves: gameMoves,
      pieces: gamePieces,
    }
  })

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
    flags: computeProfileFlags({
      delta, bestMoveRate, blunderRate, thinkReflexRatio, timeCV,
      accStd, tcType, avgRating: avgRat, games, username,
      wins: games.filter(g => g.result === 'W').length,
      losses: games.filter(g => g.result === 'L').length,
      draws: games.filter(g => g.result === 'D').length,
      accountCreatedAt,
    }),
    antiCheat: { checks, humanScore, riskLevel, passCount, warnCount, failCount },
    games: gamesList,
  }
}

function computeProfileFlags(stats: {
  delta: number | null; bestMoveRate: number; blunderRate: number
  thinkReflexRatio: number | null; timeCV: number | null
  accStd: number | null; tcType: string; avgRating: number
  games: GameRawData[]; username: string
  wins: number; losses: number; draws: number
  accountCreatedAt?: number | null // unix timestamp
}): ProfileFlag[] {
  const t = getThresholds(stats.tcType)
  const flags: ProfileFlag[] = []

  // 1. Account age vs elo (new account + high rating = suspect)
  // Realistic max rating by account age (based on chess.com stats)
  if (stats.accountCreatedAt) {
    const ageMonths = (Date.now() / 1000 - stats.accountCreatedAt) / (30 * 24 * 3600)
    const rating = stats.avgRating

    // Expected max rating by account age (generous — allows for strong OTB players)
    // suspiciousThreshold: above this = suspicious
    // flaggedThreshold: above this = flagged
    const ageBrackets = [
      { maxMonths: 1,  suspRating: 1500, flagRating: 1800 },
      { maxMonths: 3,  suspRating: 1700, flagRating: 2000 },
      { maxMonths: 6,  suspRating: 2000, flagRating: 2200 },
      { maxMonths: 12, suspRating: 2200, flagRating: 2500 },
      { maxMonths: 24, suspRating: 2400, flagRating: 2600 },
    ]

    let aaStatus: FlagStatus = 'clean'
    let bracket = ageBrackets.find(b => ageMonths < b.maxMonths)
    if (bracket) {
      if (rating > bracket.flagRating) aaStatus = 'flagged'
      else if (rating > bracket.suspRating) aaStatus = 'suspicious'
    }

    // Weight scales with how extreme the mismatch is
    // The younger the account AND the higher the rating, the heavier the weight
    let weight = 1
    if (aaStatus !== 'clean' && bracket) {
      const ratingExcess = rating - bracket.suspRating
      const ageUrgency = ageMonths < 1 ? 3 : ageMonths < 3 ? 2.5 : ageMonths < 6 ? 2 : ageMonths < 12 ? 1.5 : 1.2
      // Weight: base 1.5 + up to 1.5 more based on how far above threshold
      weight = Math.min(3, ageUrgency * (1 + Math.min(1, ratingExcess / 500)))
    }

    const ageLabel = ageMonths < 1 ? '<1 month' : ageMonths < 12 ? `${Math.round(ageMonths)} months` : `${(ageMonths / 12).toFixed(1)} years`
    flags.push({
      id: 'accountAge', label: 'Account Age', status: aaStatus, weight,
      value: `${ageLabel} · ${Math.round(rating)} elo`,
      detail: aaStatus === 'clean' ? 'Account age matches rating' : 'High rating for a new account',
    })
  }

  // 2. Win rate vs accuracy coherence
  const total = stats.wins + stats.losses + stats.draws
  if (total >= 5) {
    const winPct = (stats.wins / total) * 100
    const avgAcc = stats.delta != null ? (stats.delta + getExpectedAccuracy(stats.avgRating, stats.tcType)) : null
    if (avgAcc != null) {
      const expectedWinPct = Math.min(90, Math.max(10, (avgAcc - 50) * 2))
      const winDiff = Math.abs(winPct - expectedWinPct)
      const wrStatus: FlagStatus = winDiff > 35 ? 'flagged' : winDiff > 25 ? 'suspicious' : 'clean'
      flags.push({
        id: 'winRate', label: 'Win Rate', status: wrStatus, weight: 1,
        value: `${winPct.toFixed(0)}% wins`,
        detail: wrStatus === 'clean' ? 'Win rate matches accuracy' : 'Win rate doesn\'t match accuracy',
      })
    }
  }

  // 3. Blunder rate (too low = suspect)
  const expectedBlunder = stats.avgRating < 1200 ? 8 : stats.avgRating < 1600 ? 5 : stats.avgRating < 2000 ? 3 : stats.avgRating < 2400 ? 1.5 : 0.5
  const blStatus: FlagStatus = stats.blunderRate < expectedBlunder * 0.2 ? 'flagged' : stats.blunderRate < expectedBlunder * 0.5 ? 'suspicious' : 'clean'
  flags.push({
    id: 'blunders', label: 'Blunders', status: blStatus, weight: 1,
    value: `${stats.blunderRate.toFixed(1)}%`,
    detail: blStatus === 'clean' ? 'Normal mistake rate' : 'Suspiciously few mistakes',
  })

  // 4. Move time entropy (timeCV too low = robotic tempo)
  if (stats.timeCV != null) {
    const teStatus: FlagStatus = stats.timeCV < t.timeCV * 0.6 ? 'flagged' : stats.timeCV < t.timeCV ? 'suspicious' : 'clean'
    flags.push({
      id: 'timeEntropy', label: 'Time Entropy', status: teStatus, weight: 1,
      value: `CV ${stats.timeCV.toFixed(2)}`,
      detail: teStatus === 'clean' ? 'Natural time variation' : 'Too uniform timing',
    })
  }

  // 5. Opponent strength correlation (optional — needs ≥10 games + ≥600 elo spread)
  if (stats.games.length >= 10) {
    const gamesWithAcc = stats.games
      .map(g => ({ acc: g.caps?.[g.playerColor]?.all as number | undefined, oppRating: g.opponentRating }))
      .filter((g): g is { acc: number; oppRating: number } => g.acc != null && g.oppRating != null)

  }

  return flags
}
