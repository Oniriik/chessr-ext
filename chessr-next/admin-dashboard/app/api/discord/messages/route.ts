import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import crypto from 'crypto'

const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://chessr-discord:3100'

// GET — List all guild members (not just linked users)
export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.searchParams.get('search') || ''
    const plan = request.nextUrl.searchParams.get('plan') || ''

    // Fetch all guild members from bot
    const membersRes = await fetch(`${BOT_INTERNAL_URL}/guild-members`)
    if (!membersRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch guild members' }, { status: 500 })
    }
    const { members } = await membersRes.json() as {
      members: { discord_id: string; discord_username: string; discord_avatar: string | null; discord_in_guild: boolean }[]
    }

    // Fetch linked users from Supabase for plan/email info
    const supabase = getServiceRoleClient()
    const { data: linkedUsers } = await supabase
      .from('user_settings')
      .select('user_id, discord_id, discord_username, plan')
      .not('discord_id', 'is', null)

    const linkedMap = new Map<string, { user_id: string; plan: string | null }>()
    linkedUsers?.forEach(u => {
      if (u.discord_id) linkedMap.set(u.discord_id, { user_id: u.user_id, plan: u.plan })
    })

    // Get emails from auth.users
    const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const emailMap = new Map<string, string>()
    authUsers?.users?.forEach(u => emailMap.set(u.id, u.email || ''))

    // Merge guild members with linked user data
    let result = members.map(m => {
      const linked = linkedMap.get(m.discord_id)
      return {
        discord_id: m.discord_id,
        discord_username: m.discord_username,
        discord_avatar: m.discord_avatar,
        discord_in_guild: true,
        user_id: linked?.user_id || null,
        plan: linked?.plan || null,
        email: linked ? emailMap.get(linked.user_id) || '' : '',
      }
    })

    // Filter by plan if specified
    if (plan) {
      result = result.filter(u => u.plan === plan)
    }

    // Filter by search
    if (search) {
      const s = search.toLowerCase()
      result = result.filter(u =>
        u.discord_username?.toLowerCase().includes(s) ||
        u.email?.toLowerCase().includes(s)
      )
    }

    // Sort: linked users first, then alphabetical
    result.sort((a, b) => {
      if (a.user_id && !b.user_id) return -1
      if (!a.user_id && b.user_id) return 1
      return (a.discord_username || '').localeCompare(b.discord_username || '')
    })

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
