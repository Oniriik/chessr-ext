import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getClients(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!serviceRoleKey) throw new Error('Missing service key')

  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Not authenticated')

  const token = authHeader.slice(7)
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  return { token, userClient, adminClient }
}

// GET /api/profile-analysis?username=xxx
export async function GET(request: NextRequest) {
  try {
    const { token, userClient, adminClient } = getClients(request)
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const username = request.nextUrl.searchParams.get('username')

    let query = adminClient
      .from('profile_analyses')
      .select('id, platform_username, platform, status, games_count, games_requested, created_at, completed_at, error_message')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    if (username) {
      query = query.eq('platform_username', username)
    }

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ analyses: data || [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    if (msg === 'Not authenticated') return NextResponse.json({ error: msg }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/profile-analysis { platformUsername }
export async function POST(request: NextRequest) {
  try {
    const { token, userClient, adminClient } = getClients(request)
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

    const body = await request.json()
    const { platformUsername, gamesCount } = body
    if (!platformUsername) return NextResponse.json({ error: 'Missing platformUsername' }, { status: 400 })
    const validGamesCount = Math.min(Math.max(gamesCount || 10, 1), 30)

    // Check no pending/analyzing analysis exists
    const { data: existing } = await adminClient
      .from('profile_analyses')
      .select('id, status')
      .eq('user_id', user.id)
      .in('status', ['pending', 'analyzing'])
      .limit(1)

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Analysis already in progress', existingId: existing[0].id }, { status: 409 })
    }

    const { data, error } = await adminClient
      .from('profile_analyses')
      .insert({
        user_id: user.id,
        platform_username: platformUsername,
        platform: 'chesscom',
        status: 'pending',
        games_requested: validGamesCount,
      })
      .select('id')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ id: data.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    if (msg === 'Not authenticated') return NextResponse.json({ error: msg }, { status: 401 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
