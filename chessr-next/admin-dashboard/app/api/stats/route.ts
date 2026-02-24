import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

// Time period options in hours
const TIME_PERIODS: Record<string, number> = {
  '1h': 1,
  '6h': 6,
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '24h'
    const wsServerUrl = process.env.WS_SERVER_URL || 'http://localhost:8080'

    // Validate period
    const hours = TIME_PERIODS[period]
    if (!hours) {
      return NextResponse.json({ error: 'Invalid time period' }, { status: 400 })
    }

    // Calculate time threshold
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    // Fetch real-time stats from WebSocket server
    let realtime = { connectedUsers: 0, connectedClients: 0 }
    let queues = null
    let pools = null

    try {
      const statsResponse = await fetch(`${wsServerUrl}/stats`, {
        cache: 'no-store',
      })
      if (statsResponse.ok) {
        const wsStats = await statsResponse.json()
        realtime = wsStats.realtime
        queues = wsStats.queues
        pools = wsStats.pools
      }
    } catch (err) {
      console.error('Failed to fetch WS server stats:', err)
    }

    // Query Supabase for activity stats
    const supabase = getServiceRoleClient()

    // Calculate total waiting (from both queues) and update max if needed
    const totalWaiting =
      (queues?.suggestion?.pending || 0) +
      (queues?.analysis?.pending || 0) +
      (pools?.komodo?.waiting || 0) +
      (pools?.stockfish?.waiting || 0)

    // Update max waiting in background (fire and forget)
    if (totalWaiting > 0) {
      supabase.rpc('update_max_waiting', { current_waiting: totalWaiting }).catch((err) => {
        console.error('Failed to update max_waiting:', err)
      })
    }

    // Get distinct active users in the time period
    const { data: activeData, error: activeError } = await supabase
      .from('user_activity')
      .select('user_id')
      .gte('created_at', since)

    if (activeError) {
      console.error('Error fetching active users:', activeError)
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
    }

    // Count unique user IDs
    const uniqueUserIds = new Set(activeData?.map((r) => r.user_id) || [])
    const activeUsersCount = uniqueUserIds.size

    // Get breakdown by event type
    const { data: breakdownData } = await supabase
      .from('user_activity')
      .select('event_type')
      .gte('created_at', since)

    const breakdown = {
      suggestions: breakdownData?.filter((r) => r.event_type === 'suggestion').length || 0,
      analyses: breakdownData?.filter((r) => r.event_type === 'analysis').length || 0,
    }

    // Get global stats
    const { data: globalStats } = await supabase.from('global_stats').select('key, value')

    const globalStatsMap = new Map(globalStats?.map((s) => [s.key, s.value]) || [])

    return NextResponse.json({
      realtime,
      queues,
      pools,
      activity: {
        period,
        activeUsers: activeUsersCount,
        totalRequests: breakdown.suggestions + breakdown.analyses,
        breakdown,
      },
      global: {
        totalSuggestions: globalStatsMap.get('total_suggestions') || 0,
        maxWaiting24h: globalStatsMap.get('max_waiting_24h') || 0,
      },
    })
  } catch (error) {
    console.error('GET stats error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
