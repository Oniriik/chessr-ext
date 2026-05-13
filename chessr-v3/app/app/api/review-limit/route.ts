import { NextRequest, NextResponse } from 'next/server'

/** Thin proxy to the chessr-v3 serveur. The Supabase user_activity table
 *  was truncated when we dropped back to the free tier; live data lives
 *  on the local Postgres on chessr-beta. The serveur exposes the same
 *  payload shape via /api/review-limit so the frontend doesn't have to
 *  change. Fail-open: any fetch error returns "no limit" so the UI keeps
 *  rendering. */
const API_URL = process.env.NEXT_PUBLIC_CHESSR_API_URL || 'https://api.chessr.io'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  try {
    const res = await fetch(`${API_URL}/api/review-limit`, {
      headers: authHeader ? { Authorization: authHeader } : {},
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ isLimited: false, dailyUsage: 0, dailyLimit: null })
  }
}
