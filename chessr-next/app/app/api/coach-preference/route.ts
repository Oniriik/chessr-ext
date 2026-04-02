import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

// GET: fetch user's preferred coach
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ') || !serviceKey) {
    return NextResponse.json({ coach: 'Generic_coach' })
  }

  try {
    const token = authHeader.slice(7)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await userClient.auth.getUser(token)
    if (!user) return NextResponse.json({ coach: 'Generic_coach' })

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data } = await adminClient
      .from('user_settings')
      .select('preferred_coach')
      .eq('user_id', user.id)
      .single()

    return NextResponse.json({ coach: data?.preferred_coach || 'Generic_coach' })
  } catch {
    return NextResponse.json({ coach: 'Generic_coach' })
  }
}

// POST: save user's preferred coach
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ') || !serviceKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { coach } = await request.json()
    if (!coach) return NextResponse.json({ error: 'Missing coach' }, { status: 400 })

    const token = authHeader.slice(7)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user } } = await userClient.auth.getUser(token)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await adminClient
      .from('user_settings')
      .update({ preferred_coach: coach })
      .eq('user_id', user.id)

    return NextResponse.json({ ok: true, coach })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
