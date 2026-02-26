import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

const PERIODS: Record<string, { hours: number; bucketMs: number; bucketLabel: string }> = {
  '10mn': { hours: 10 / 60, bucketMs: 60_000, bucketLabel: '1min' },
  '30mn': { hours: 0.5, bucketMs: 120_000, bucketLabel: '2min' },
  '1h': { hours: 1, bucketMs: 300_000, bucketLabel: '5min' },
  '3h': { hours: 3, bucketMs: 900_000, bucketLabel: '15min' },
  '6h': { hours: 6, bucketMs: 1800_000, bucketLabel: '30min' },
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

function pickBucketMs(durationMs: number): number {
  const hours = durationMs / 3600_000
  if (hours <= 1) return 300_000       // 5min buckets
  if (hours <= 6) return 1800_000      // 30min buckets
  if (hours <= 48) return 3600_000     // 1h buckets
  if (hours <= 168) return 21600_000   // 6h buckets
  return 86400_000                     // daily buckets
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '24h'
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')

    let now: number
    let since: number
    let bucketMs: number

    if (fromParam && toParam) {
      since = new Date(fromParam).getTime()
      now = new Date(toParam).getTime()
      if (isNaN(since) || isNaN(now) || now <= since) {
        return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
      }
      bucketMs = pickBucketMs(now - since)
    } else {
      const config = PERIODS[period]
      if (!config) {
        return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
      }
      now = Date.now()
      since = now - config.hours * 3600_000
      bucketMs = config.bucketMs
    }

    const sinceISO = new Date(since).toISOString()
    const nowISO = new Date(now).toISOString()

    const supabase = getServiceRoleClient()

    // Fetch all activity rows in period (paginate to bypass 1000 row limit)
    const rows: { event_type: string; created_at: string; user_id: string }[] = []
    const PAGE_SIZE = 1000
    let from = 0

    while (true) {
      let query = supabase
        .from('user_activity')
        .select('event_type, created_at, user_id')
        .gte('created_at', sinceISO)
        .lte('created_at', nowISO)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      const { data, error } = await query

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

    // Top 10 users by suggestion count
    const userSuggestionCounts = new Map<string, number>()
    for (const row of rows) {
      if (row.event_type === 'suggestion') {
        userSuggestionCounts.set(row.user_id, (userSuggestionCounts.get(row.user_id) || 0) + 1)
      }
    }
    const topUserIds = Array.from(userSuggestionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    // Fetch emails for top users from auth
    let topUsers: { user_id: string; email: string; count: number }[] = []
    if (topUserIds.length > 0) {
      const emailMap = new Map<string, string>()
      // Fetch all auth users to map IDs to emails
      let authPage = 1
      while (true) {
        const { data: authBatch } = await supabase.auth.admin.listUsers({
          page: authPage,
          perPage: 1000,
        })
        if (!authBatch?.users.length) break
        for (const u of authBatch.users) {
          emailMap.set(u.id, u.email || '')
        }
        if (authBatch.users.length < 1000) break
        authPage++
      }

      topUsers = topUserIds.map(([id, count]) => ({
        user_id: id,
        email: emailMap.get(id) || id.slice(0, 8),
        count,
      }))
    }

    // Timeline
    const timeline = bucketize(rows, since, now, bucketMs)

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
      topUsers,
    })
  } catch (error) {
    console.error('GET data error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
