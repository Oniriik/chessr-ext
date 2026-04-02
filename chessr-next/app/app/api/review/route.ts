import { NextRequest, NextResponse } from 'next/server'

// Proxy to Chessr server for Chess.com game review
// The Chessr server handles: moveList decode, auth token, WS to Chess.com
const CHESSR_WS_URL = process.env.NEXT_PUBLIC_CHESSR_WS_URL || 'ws://localhost:8080'

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get('id')
  const gameType = request.nextUrl.searchParams.get('type') || 'live'

  if (!gameId) {
    return NextResponse.json({ error: 'Missing game id' }, { status: 400 })
  }

  try {
    // Connect to Chessr WS server and request chesscom_review
    const analysis = await fetchFromChessr(gameId, gameType)
    return NextResponse.json({ analysis })
  } catch (err) {
    console.error('[API /review] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}

function fetchFromChessr(gameId: string, gameType: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Use native WebSocket (available in Node.js 22+)
    const ws = new WebSocket(CHESSR_WS_URL)
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout (60s)')) }, 60000)

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'chesscom_review',
        requestId: `review-${gameId}`,
        gameId,
        gameType,
      }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'chesscom_review_result') {
          clearTimeout(timeout)
          ws.close()
          resolve(msg.analysis)
        }
        if (msg.type === 'chesscom_review_error') {
          clearTimeout(timeout)
          ws.close()
          reject(new Error(msg.error || 'Analysis failed'))
        }
        // Ignore progress messages
      } catch { /* ignore */ }
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Connection to Chessr server failed'))
    }
  })
}
