import { NextRequest, NextResponse } from 'next/server'

/** Thin proxy to the chessr-v3 serveur /api/review-cache. The Supabase
 *  game_reviews table was truncated when we dropped back to the free
 *  tier; cached analyses live on the local Postgres on chessr-beta.
 *  Fail-open: any fetch error returns { cached: false } so the review
 *  page falls through to a fresh fetch path. */
const API_URL = process.env.NEXT_PUBLIC_CHESSR_API_URL || 'https://api.chessr.io'

export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get('id') || ''
  const coachId = request.nextUrl.searchParams.get('coach') || 'Generic_coach'
  if (!gameId) return NextResponse.json({ error: 'Missing game id' }, { status: 400 })
  try {
    const url = new URL(`${API_URL}/api/review-cache`)
    url.searchParams.set('id', gameId)
    url.searchParams.set('coach', coachId)
    const res = await fetch(url.toString(), { cache: 'no-store' })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ cached: false })
  }
}
