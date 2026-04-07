import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

export async function GET() {
  try {
    const supabase = getServiceRoleClient()

    // Get all periods (active first, then by date)
    const { data: periods } = await supabase
      .from('giveaway_periods')
      .select('*')
      .order('active', { ascending: false })
      .order('created_at', { ascending: false })

    // Get active period
    const activePeriod = periods?.find((p) => p.active) || null

    // Get invite breakdown for active period
    let inviteBreakdown: { inviter_discord_id: string; inviter_username: string; count: number }[] = []
    let totalInvites = 0

    if (activePeriod) {
      const { data: invites } = await supabase
        .from('invite_events')
        .select('inviter_discord_id, inviter_username, still_in_guild')
        .eq('still_in_guild', true)
        .gte('created_at', activePeriod.starts_at)
        .lte('created_at', activePeriod.ends_at)

      if (invites) {
        totalInvites = invites.length
        const counts: Record<string, { username: string; count: number }> = {}
        for (const inv of invites) {
          if (!counts[inv.inviter_discord_id]) {
            counts[inv.inviter_discord_id] = { username: inv.inviter_username || inv.inviter_discord_id, count: 0 }
          }
          counts[inv.inviter_discord_id].count++
        }
        inviteBreakdown = Object.entries(counts)
          .map(([id, data]) => ({ inviter_discord_id: id, ...data }))
          .sort((a, b) => b.count - a.count)
      }
    }

    // Get daily invite counts for active period (for chart)
    let dailyInvites: { date: string; count: number }[] = []
    if (activePeriod) {
      const { data: invites } = await supabase
        .from('invite_events')
        .select('created_at')
        .eq('still_in_guild', true)
        .gte('created_at', activePeriod.starts_at)
        .lte('created_at', activePeriod.ends_at)
        .order('created_at', { ascending: true })

      if (invites) {
        const byDay: Record<string, number> = {}
        for (const inv of invites) {
          const day = inv.created_at.slice(0, 10)
          byDay[day] = (byDay[day] || 0) + 1
        }
        dailyInvites = Object.entries(byDay).map(([date, count]) => ({ date, count }))
      }
    }

    return NextResponse.json({
      periods: periods || [],
      activePeriod,
      inviteBreakdown,
      totalInvites,
      dailyInvites,
    })
  } catch (error) {
    console.error('GET giveaway error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { action, ...body } = await request.json()
    const supabase = getServiceRoleClient()

    if (action === 'create') {
      // Deactivate all existing periods
      await supabase
        .from('giveaway_periods')
        .update({ active: false })
        .eq('active', true)

      // Create new period
      const { data, error } = await supabase
        .from('giveaway_periods')
        .insert({
          name: body.name || 'Giveaway',
          starts_at: new Date().toISOString(),
          ends_at: body.ends_at,
          active: true,
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true, period: data })
    }

    if (action === 'stop') {
      await supabase
        .from('giveaway_periods')
        .update({ active: false })
        .eq('active', true)

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('POST giveaway error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
