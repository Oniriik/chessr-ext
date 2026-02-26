import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

const PERIODS: Record<string, { hours: number; bucketMs: number; bucketLabel: string }> = {
  '24h': { hours: 24, bucketMs: 3600_000, bucketLabel: 'hourly' },
  '48h': { hours: 48, bucketMs: 3600_000, bucketLabel: 'hourly' },
  '7d': { hours: 168, bucketMs: 21600_000, bucketLabel: '6h' },
  '30d': { hours: 720, bucketMs: 86400_000, bucketLabel: 'daily' },
}

function bucketize(
  rows: { event_type: string; created_at: string; user_id: string }[],
  since: number,
  now: number,
  bucketMs: number
) {
  // Initialize empty buckets
  const suggestionsMap = new Map<number, number>()
  const analysesMap = new Map<number, number>()
  const usersMap = new Map<number, Set<string>>()

  for (let t = Math.floor(since / bucketMs) * bucketMs; t <= now; t += bucketMs) {
    suggestionsMap.set(t, 0)
    analysesMap.set(t, 0)
    usersMap.set(t, new Set())
  }

  // Fill buckets
  for (const row of rows) {
    const ts = new Date(row.created_at).getTime()
    const bucket = Math.floor(ts / bucketMs) * bucketMs

    if (row.event_type === 'suggestion') {
      suggestionsMap.set(bucket, (suggestionsMap.get(bucket) || 0) + 1)
      usersMap.get(bucket)?.add(row.user_id)
    } else if (row.event_type === 'analysis') {
      analysesMap.set(bucket, (analysesMap.get(bucket) || 0) + 1)
    }
  }

  // Convert to arrays
  const times = Array.from(suggestionsMap.keys()).sort((a, b) => a - b)

  const activity = times.map((t) => ({
    time: new Date(t).toISOString(),
    suggestions: suggestionsMap.get(t) || 0,
    analyses: analysesMap.get(t) || 0,
  }))

  const activeUsers = times.map((t) => ({
    time: new Date(t).toISOString(),
    count: usersMap.get(t)?.size || 0,
  }))

  return { activity, activeUsers }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '24h'

    const config = PERIODS[period]
    if (!config) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }

    const now = Date.now()
    const since = now - config.hours * 3600_000
    const sinceISO = new Date(since).toISOString()

    const supabase = getServiceRoleClient()

    // Fetch all activity rows in period (paginate to bypass 1000 row limit)
    const rows: { event_type: string; created_at: string; user_id: string }[] = []
    const PAGE_SIZE = 1000
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('user_activity')
        .select('event_type, created_at, user_id')
        .gte('created_at', sinceISO)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        console.error('Error fetching activity:', error)
        return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
      }

      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Counts
    const suggestions = rows.filter((r) => r.event_type === 'suggestion').length
    const analyses = rows.filter((r) => r.event_type === 'analysis').length
    const uniqueUsers = new Set(
      rows.filter((r) => r.event_type === 'suggestion').map((r) => r.user_id)
    )

    // Timeline
    const timeline = bucketize(rows, since, now, config.bucketMs)

    // All-time total suggestions
    const { data: globalStats } = await supabase
      .from('global_stats')
      .select('value')
      .eq('key', 'total_suggestions')
      .single()

    return NextResponse.json({
      totalSuggestionsAllTime: globalStats?.value || 0,
      period: {
        suggestions,
        analyses,
        activeUsers: uniqueUsers.size,
      },
      timeline,
    })
  } catch (error) {
    console.error('GET data error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
