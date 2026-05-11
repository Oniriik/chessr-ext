import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Server-side proxy to the chessr-v3 serveur for Chess.com game review.
 * Used by the unauthenticated/legacy review path — when the caller is
 * already signed in client-side, the page hits the WS directly and
 * bypasses this route.
 *
 * Resolves the calling user via the Supabase service-role client
 * (the request's cookies carry the access_token) and connects to v3's
 * /ws endpoint with the same auth handshake the browser path uses.
 */

const CHESSR_WS_URL = process.env.NEXT_PUBLIC_CHESSR_WS_URL || 'ws://localhost:8080'
const APP_AUTH_TOKEN = process.env.APP_AUTH_TOKEN || process.env.NEXT_PUBLIC_APP_AUTH_TOKEN

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get('id')
  const gameType = request.nextUrl.searchParams.get('type') || 'live'
  const userColor = request.nextUrl.searchParams.get('userColor') || 'white'
  const coachId = request.nextUrl.searchParams.get('coachId') || 'Generic_coach'

  if (!gameId) return NextResponse.json({ error: 'Missing game id' }, { status: 400 })

  // Bearer token from the Authorization header. Falls back to none →
  // serveur will refuse the auth handshake and we return 401.
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7)
    : null
  if (!token) return NextResponse.json({ error: 'Missing access token' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    return NextResponse.json({ error: 'Invalid access token' }, { status: 401 })
  }
  const userId = data.user.id

  try {
    const analysis = await fetchFromChessr({ gameId, gameType, userColor, coachId, userId, token })
    return NextResponse.json({ analysis })
  } catch (err) {
    console.error('[API /review] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    )
  }
}

interface FetchArgs {
  gameId: string
  gameType: string
  userColor: string
  coachId: string
  userId: string
  token: string
}

function fetchFromChessr({ gameId, gameType, userColor, coachId, userId, token }: FetchArgs): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const wsUrl = `${CHESSR_WS_URL}/ws?userId=${encodeURIComponent(userId)}`
    const ws = new WebSocket(wsUrl)
    const timeout = setTimeout(() => { ws.close(); reject(new Error('Timeout (60s)')) }, 60000)

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token, source: 'app', appToken: APP_AUTH_TOKEN }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        if (msg.type === 'auth_error') {
          clearTimeout(timeout); ws.close()
          reject(new Error(`Auth failed: ${msg.error}`))
          return
        }
        if (msg.type === 'auth_success') {
          ws.send(JSON.stringify({
            type: 'chesscom_review',
            requestId: `review-${gameId}`,
            gameId, gameType, coachId, userColor,
          }))
          return
        }
        if (msg.type === 'chesscom_review_result') {
          clearTimeout(timeout); ws.close()
          resolve(msg.analysis)
        }
        if (msg.type === 'chesscom_review_error') {
          clearTimeout(timeout); ws.close()
          reject(new Error(msg.error || 'Analysis failed'))
        }
        // progress messages are ignored
      } catch { /* ignore */ }
    }

    ws.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('Connection to Chessr server failed'))
    }
  })
}
