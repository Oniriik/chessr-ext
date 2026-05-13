import { NextRequest, NextResponse } from 'next/server'

/** Thin proxy to the chessr-v3 serveur — see app/api/review-limit
 *  for the migration context. Same fail-open behaviour. */
const API_URL = process.env.NEXT_PUBLIC_CHESSR_API_URL || 'https://api.chessr.io'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  try {
    const res = await fetch(`${API_URL}/api/profile-analysis-limit`, {
      headers: authHeader ? { Authorization: authHeader } : {},
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ isLimited: false, weeklyUsage: 0, weeklyLimit: null })
  }
}
