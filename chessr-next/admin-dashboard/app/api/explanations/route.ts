import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

const PERIODS: Record<string, { hours: number; bucketMs: number }> = {
  '10mn': { hours: 10 / 60, bucketMs: 60_000 },
  '30mn': { hours: 0.5, bucketMs: 120_000 },
  '1h': { hours: 1, bucketMs: 300_000 },
  '3h': { hours: 3, bucketMs: 900_000 },
  '6h': { hours: 6, bucketMs: 1800_000 },
  '24h': { hours: 24, bucketMs: 3600_000 },
  '48h': { hours: 48, bucketMs: 3600_000 },
  '7d': { hours: 168, bucketMs: 21600_000 },
  '30d': { hours: 720, bucketMs: 86400_000 },
}

function pickBucketMs(durationMs: number): number {
  const hours = durationMs / 3600_000
  if (hours <= 1) return 300_000
  if (hours <= 6) return 1800_000
  if (hours <= 48) return 3600_000
  if (hours <= 168) return 21600_000
  return 86400_000
}

function bucketize(
  rows: { created_at: string; user_id: string }[],
  since: number,
  now: number,
  bucketMs: number
) {
  const explanationsMap = new Map<number, number>()
  const usersMap = new Map<number, Set<string>>()

  for (let t = Math.floor(since / bucketMs) * bucketMs; t <= now; t += bucketMs) {
    explanationsMap.set(t, 0)
    usersMap.set(t, new Set())
  }

  for (const row of rows) {
    const ts = new Date(row.created_at).getTime()
    const bucket = Math.floor(ts / bucketMs) * bucketMs
    explanationsMap.set(bucket, (explanationsMap.get(bucket) || 0) + 1)
    usersMap.get(bucket)?.add(row.user_id)
  }

  const times = Array.from(explanationsMap.keys()).sort((a, b) => a - b)

  const explanations = times.map((t) => ({
    time: new Date(t).toISOString(),
    count: explanationsMap.get(t) || 0,
  }))

  const activeUsers = times.map((t) => ({
    time: new Date(t).toISOString(),
    count: usersMap.get(t)?.size || 0,
  }))

  return { explanations, activeUsers }
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

    // Fetch explanation activity rows (paginate to bypass 1000 row limit)
    const rows: { created_at: string; user_id: string }[] = []
    const PAGE_SIZE = 1000
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('user_activity')
        .select('created_at, user_id')
        .eq('event_type', 'explanation')
        .gte('created_at', sinceISO)
        .lte('created_at', nowISO)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) {
        console.error('Error fetching explanations:', error)
        return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
      }

      if (!data || data.length === 0) break
      rows.push(...data)
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Counts
    const uniqueUsers = new Set(rows.map((r) => r.user_id))

    // Top 10 users
    const userCounts = new Map<string, number>()
    for (const row of rows) {
      userCounts.set(row.user_id, (userCounts.get(row.user_id) || 0) + 1)
    }
    const topUserIds = Array.from(userCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)

    let topUsers: { user_id: string; email: string; discord_username: string | null; count: number }[] = []
    if (topUserIds.length > 0) {
      const ids = topUserIds.map(([id]) => id)

      const emailEntries = await Promise.all(
        ids.map(async (id) => {
          const { data } = await supabase.auth.admin.getUserById(id)
          return [id, data?.user?.email || id.slice(0, 8)] as const
        }),
      )
      const emailMap = new Map(emailEntries)

      const { data: settingsData } = await supabase
        .from('user_settings')
        .select('user_id, discord_username')
        .in('user_id', ids)

      const discordMap = new Map<string, string>()
      if (settingsData) {
        for (const s of settingsData) {
          if (s.discord_username) discordMap.set(s.user_id, s.discord_username)
        }
      }

      topUsers = topUserIds.map(([id, count]) => ({
        user_id: id,
        email: emailMap.get(id) || id.slice(0, 8),
        discord_username: discordMap.get(id) || null,
        count,
      }))
    }

    // Timeline
    const timeline = bucketize(rows, since, now, bucketMs)

    // All-time total
    const { data: globalStats } = await supabase
      .from('global_stats')
      .select('value')
      .eq('key', 'total_explanations')
      .single()

    return NextResponse.json({
      totalAll: globalStats?.value || 0,
      period: {
        count: rows.length,
        uniqueUsers: uniqueUsers.size,
      },
      timeline,
      topUsers,
    })
  } catch (error) {
    console.error('GET explanations error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
