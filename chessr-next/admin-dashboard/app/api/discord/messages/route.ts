import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import crypto from 'crypto'

const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://chessr-discord:3100'

// GET — List users with Discord linked
export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceRoleClient()
    const search = request.nextUrl.searchParams.get('search') || ''
    const plan = request.nextUrl.searchParams.get('plan') || ''

    let query = supabase
      .from('user_settings')
      .select('user_id, discord_id, discord_username, discord_avatar, discord_in_guild, plan')
      .not('discord_id', 'is', null)
      .order('discord_username', { ascending: true })

    if (plan) {
      query = query.eq('plan', plan)
    }

    const { data: users, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get emails from auth.users
    const userIds = users?.map(u => u.user_id) || []
    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 })

    const emailMap = new Map<string, string>()
    authUsers?.users?.forEach(u => emailMap.set(u.id, u.email || ''))

    let result = users?.map(u => ({
      ...u,
      email: emailMap.get(u.user_id) || '',
    })) || []

    // Filter by search (username or email)
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(u =>
        u.discord_username?.toLowerCase().includes(s) ||
        u.email?.toLowerCase().includes(s)
      )
    }

    return NextResponse.json({ users: result })
  } catch (error) {
    console.error('Discord messages GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — Start sending DMs
export async function POST(request: NextRequest) {
  try {
    const { discordIds, content } = await request.json()

    if (!discordIds?.length || !content) {
      return NextResponse.json({ error: 'Missing discordIds or content' }, { status: 400 })
    }

    const jobId = crypto.randomUUID()

    const res = await fetch(`${BOT_INTERNAL_URL}/send-dm-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, discordIds, content }),
    })

    if (!res.ok) {
      const data = await res.json()
      return NextResponse.json({ error: data.error || 'Failed to start DM batch' }, { status: res.status })
    }

    return NextResponse.json({ jobId })
  } catch (error) {
    console.error('Discord messages POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
