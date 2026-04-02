import { NextRequest, NextResponse } from 'next/server'
import { Chess } from 'chess.js'

// Proxy Chess.com game data to avoid CORS issues
export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get('id')
  if (!gameId) {
    return NextResponse.json({ error: 'Missing game id' }, { status: 400 })
  }

  try {
    const res = await fetch(`https://www.chess.com/callback/live/game/${gameId}?all=true`, {
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 })
    }

    const data = await res.json()
    const game = data.game
    const headers = game?.pgnHeaders || {}
    const moveList = game?.moveList || ''

    // Decode moveList to SAN moves
    const moves = decodeMoveList(moveList)

    // Decode timestamps to clocks
    const timestamps = (game?.moveTimestamps || '').split(',').filter(Boolean).map(Number)
    const tc = headers?.TimeControl || ''
    const tcMatch = tc.match(/^(\d+)\+?(\d+)?$/)
    const baseTime = tcMatch ? parseInt(tcMatch[1]) : 0
    const increment = tcMatch && tcMatch[2] ? parseInt(tcMatch[2]) : 0

    if (baseTime > 0 && timestamps.length > 0) {
      const clocks = { w: baseTime, b: baseTime }
      for (let i = 0; i < moves.length && i < timestamps.length; i++) {
        const color = moves[i].color
        const elapsed = timestamps[i] / 10 // timestamps are in tenths of seconds
        clocks[color] = Math.max(0, clocks[color] - elapsed + (i >= 2 ? increment : 0))
        const secs = Math.floor(clocks[color])
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        const s = secs % 60
        moves[i].clock = h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`
      }
    }

    return NextResponse.json({
      headers,
      moves,
      plyCount: game?.plyCount || 0,
    })
  } catch (err) {
    console.error('[API /game] Error:', err)
    return NextResponse.json({ error: 'Failed to fetch game' }, { status: 500 })
  }
}

function decodeMoveList(moveList: string): Array<{ san: string; fen: string; color: 'w' | 'b'; clock?: string }> {
  function charToIdx(ch: string): number {
    const cc = ch.charCodeAt(0)
    if (cc >= 97 && cc <= 122) return cc - 97
    if (cc >= 65 && cc <= 90) return cc - 65 + 26
    if (cc >= 48 && cc <= 57) return cc - 48 + 52
    if (cc === 33) return 62
    if (cc === 63) return 63
    return -1
  }

  function idxToSq(idx: number): string {
    return String.fromCharCode(97 + (idx % 8)) + (Math.floor(idx / 8) + 1)
  }

  const chess = new Chess()
  const result: Array<{ san: string; fen: string; color: 'w' | 'b' }> = []

  for (let i = 0; i + 1 < moveList.length; i += 2) {
    const fi = charToIdx(moveList[i])
    const ti = charToIdx(moveList[i + 1])
    if (fi < 0 || ti < 0) continue

    const from = idxToSq(fi)
    const to = idxToSq(ti)

    try {
      let move = chess.move({ from, to })
      if (!move) {
        for (const p of ['q', 'r', 'b', 'n'] as const) {
          try {
            move = chess.move({ from, to, promotion: p })
            if (move) break
          } catch { /* skip */ }
        }
      }
      if (move) {
        result.push({ san: move.san, fen: chess.fen(), color: move.color })
      }
    } catch {
      // Invalid move, skip
    }
  }

  return result
}
