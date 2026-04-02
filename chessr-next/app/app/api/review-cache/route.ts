import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Check if a game review is cached in DB
export async function GET(request: NextRequest) {
  const gameId = request.nextUrl.searchParams.get('id')
  const coachId = request.nextUrl.searchParams.get('coach') || 'Generic_coach'
  if (!gameId) {
    return NextResponse.json({ error: 'Missing game id' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ cached: false })
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data } = await supabase
      .from('game_reviews')
      .select('analysis')
      .eq('game_id', gameId)
      .eq('platform', 'chesscom')
      .eq('coach_id', coachId)
      .single()

    if (data?.analysis) {
      return NextResponse.json({ cached: true, analysis: data.analysis })
    }

    return NextResponse.json({ cached: false })
  } catch {
    return NextResponse.json({ cached: false })
  }
}
