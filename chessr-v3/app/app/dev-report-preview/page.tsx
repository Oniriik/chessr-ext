'use client'

/**
 * Dev-only preview of the profile-analysis report with synthetic data —
 * lets you iterate on the report UI without running a real analysis.
 * 404s outside `npm run dev`.
 */

import { notFound } from 'next/navigation'
import { computePlayDNA, type GameRawData } from '@/lib/play-dna'
import { AnalysisReport } from '@/components/profile-report'

// Deterministic LCG so the preview is stable across reloads
function makeRng(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
}

const CLASSES = ['best', 'excellent', 'good', 'great', 'inaccuracy', 'mistake', 'blunder', 'miss']
const OPENINGS = [
  { eco: 'C50', url: 'https://www.chess.com/openings/Italian-Game-Two-Knights-Defense' },
  { eco: 'B20', url: 'https://www.chess.com/openings/Sicilian-Defense-Open-2.Nf3' },
  { eco: 'B10', url: 'https://www.chess.com/openings/Caro-Kann-Defense-Advance-Variation' },
]
const SANS = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Nc3', 'Nxe4', 'O-O', 'Bxc3', 'bxc3', 'd5', 'Ba3', 'dxc4', 'Re1', 'Be6', 'Rxe4', 'Qd5', 'Qe2', 'O-O-O', 'Ne5', 'Nxe5', 'Rxe5', 'Qd6']

function fakeGame(i: number, rng: () => number, opts?: { outlier?: boolean }): GameRawData {
  const nPlies = 50 + Math.floor(rng() * 40)
  const playerColor: 'white' | 'black' = rng() > 0.5 ? 'white' : 'black'
  const strong = opts?.outlier ?? false
  const positions: GameRawData['positions'] = []
  let cp = 0
  let clkW = 300, clkB = 300
  const clkParts: string[] = []

  for (let ply = 1; ply <= nPlies; ply++) {
    const color = ply % 2 === 1 ? 'white' : 'black'
    const isPlayer = color === playerColor
    const inBook = ply <= 8
    const r = rng()
    let cls = 'book'
    if (!inBook) {
      const goodBias = isPlayer && strong ? 0.55 : 0.28
      cls = r < goodBias ? 'best'
        : r < goodBias + 0.35 ? CLASSES[1 + Math.floor(rng() * 3)]
        : r < 0.93 ? 'inaccuracy'
        : CLASSES[5 + Math.floor(rng() * 3)]
    }
    const swing = cls === 'blunder' ? 2 + rng() * 3 : cls === 'mistake' ? 1 + rng() : cls === 'inaccuracy' ? 0.4 : 0.05
    cp += (color === 'white' ? -1 : 1) * swing * 30 * (rng() > 0.5 ? 1 : 0.4)
    const spend = 1 + rng() * (cls === 'blunder' ? 2 : 8)
    if (color === 'white') clkW = Math.max(3, clkW - spend); else clkB = Math.max(3, clkB - spend)
    const clk = color === 'white' ? clkW : clkB
    const h = Math.floor(clk / 3600), m = Math.floor((clk % 3600) / 60), s = (clk % 60).toFixed(1)
    clkParts.push(`${ply % 2 === 1 ? `${Math.ceil(ply / 2)}. ` : ''}${SANS[ply % SANS.length]} {[%clk ${h}:${String(m).padStart(2, '0')}:${s}]}`)

    positions.push({
      color,
      classificationName: cls,
      isPositionCritical: !inBook && rng() < 0.18,
      difference: cls === 'book' ? 0 : swing,
      ply,
      san: SANS[ply % SANS.length],
      caps2: cls === 'book' ? 100 : Math.max(20, Math.min(100, 92 - swing * 18 + rng() * 8)),
      playedCp: Math.round(cp),
      bestCp: Math.round(cp + swing * 20),
      mateIn: null,
    })
  }

  const op = OPENINGS[i % OPENINGS.length]
  const acc = strong ? 93 + rng() * 3 : 72 + rng() * 14
  const result: 'W' | 'L' | 'D' = strong ? 'W' : rng() < 0.55 ? 'W' : rng() < 0.85 ? 'L' : 'D'
  const gp0 = acc + 3, gp1 = acc - 1, gp2 = acc - 6

  return {
    gameId: `90000000${i}`,
    playerColor,
    playerRating: 1840 + Math.floor(rng() * 40),
    opponentName: `opponent_${i + 1}`,
    opponentRating: 1800 + Math.floor(rng() * 100),
    result,
    timeControl: '300+0',
    publicPgn: `[Event "Live Chess"]\n[ECO "${op.eco}"]\n[ECOUrl "${op.url}"]\n\n${clkParts.join(' ')} 1-0`,
    caps: {
      [playerColor]: { all: acc, gp0, gp1, gp2, K: acc - 5, Q: acc + 1, R: acc - 2, B: acc + 2, N: acc + 4, P: acc },
      [playerColor === 'white' ? 'black' : 'white']: { all: 75 },
    },
    reportCard: { [playerColor]: { effectiveElo: Math.round(1500 + acc * 8) } },
    positions,
    bookPly: 8,
    whiteName: playerColor === 'white' ? 'DarkKnight_92' : `opponent_${i + 1}`,
    blackName: playerColor === 'black' ? 'DarkKnight_92' : `opponent_${i + 1}`,
    eco: op.eco,
    ecoUrl: op.url,
    gamePhases: [21, 60],
  }
}

export default function DevReportPreview() {
  if (process.env.NODE_ENV !== 'development') notFound()

  const rng = makeRng(42)
  const games: GameRawData[] = []
  for (let i = 0; i < 14; i++) games.push(fakeGame(i, rng))
  games.push(fakeGame(14, rng, { outlier: true }))
  // A few bullet games for the cadence selector
  for (let i = 15; i < 21; i++) {
    const g = fakeGame(i, rng)
    g.timeControl = '60+0'
    games.push(g)
  }

  const result = computePlayDNA(games, 'DarkKnight_92', {
    accountCreatedAt: Math.floor(Date.now() / 1000) - 2.3 * 365 * 24 * 3600,
  })

  const profile = {
    avatar: '', name: 'DarkKnight_92', username: 'DarkKnight_92',
    joined: 'Mar 2024', totalGames: 2431,
    bullet: 1712, blitz: 1856, rapid: 1904,
    peak: { mode: 'Rapid', rating: 1956 },
  }

  return (
    <main className="relative z-10 max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-3 sm:px-4 py-6">
      <p className="text-xs text-muted-foreground border border-dashed border-primary/40 bg-primary/5 rounded-lg px-3 py-2 mb-4">
        Dev preview — synthetic data through the real computePlayDNA + AnalysisReport pipeline.
      </p>
      <AnalysisReport result={result} profile={profile} />
    </main>
  )
}
