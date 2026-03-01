import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

type RatingType = 'bullet' | 'blitz' | 'rapid'

const RATING_FIELDS: Record<RatingType, string> = {
  bullet: 'rating_bullet',
  blitz: 'rating_blitz',
  rapid: 'rating_rapid',
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const type = (searchParams.get('type') || 'blitz') as RatingType
    const discordOnly = searchParams.get('discord_only') === 'true'
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    if (!RATING_FIELDS[type]) {
      return NextResponse.json({ error: 'Invalid rating type. Use bullet, blitz, or rapid.' }, { status: 400 })
    }

    const ratingField = RATING_FIELDS[type]
    const supabase = getServiceRoleClient()

    // Fetch all active accounts with the requested rating
    const { data: accounts, error } = await supabase
      .from('linked_accounts')
      .select('user_id, platform, platform_username, rating_bullet, rating_blitz, rating_rapid')
      .is('unlinked_at', null)
      .not(ratingField, 'is', null)
      .gt(ratingField, 0)

    if (error) {
      console.error('Leaderboard query error:', error)
      return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
    }

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ leaderboard: [], type })
    }

    // Group by user_id, keep the account with the highest rating
    const userBest = new Map<string, { rating: number; platform: string; platform_username: string }>()

    for (const acc of accounts) {
      const rating = acc[ratingField as keyof typeof acc] as number
      const existing = userBest.get(acc.user_id)
      if (!existing || rating > existing.rating) {
        userBest.set(acc.user_id, {
          rating,
          platform: acc.platform,
          platform_username: acc.platform_username,
        })
      }
    }

    // Sort by rating descending
    let sorted = Array.from(userBest.entries()).sort((a, b) => b[1].rating - a[1].rating)

    // Fetch discord info for all users
    const allUserIds = sorted.map(([id]) => id)
    const discordMap = new Map<string, string>()
    const discordLinkedIds = new Set<string>()

    const CHUNK = 100
    for (let i = 0; i < allUserIds.length; i += CHUNK) {
      const chunk = allUserIds.slice(i, i + CHUNK)
      const { data: settings } = await supabase
        .from('user_settings')
        .select('user_id, discord_username, discord_id')
        .in('user_id', chunk)

      if (settings) {
        for (const s of settings) {
          if (s.discord_username) discordMap.set(s.user_id, s.discord_username)
          if (s.discord_id) discordLinkedIds.add(s.user_id)
        }
      }
    }

    // Apply discord filter
    if (discordOnly) {
      sorted = sorted.filter(([id]) => discordLinkedIds.has(id))
    }

    // Limit
    sorted = sorted.slice(0, limit)

    // Fetch emails
    const emailEntries = await Promise.all(
      sorted.map(async ([id]) => {
        const { data } = await supabase.auth.admin.getUserById(id)
        return [id, data?.user?.email || ''] as const
      }),
    )
    const emailMap = new Map(emailEntries)

    const leaderboard = sorted.map(([id, best]) => ({
      user_id: id,
      email: emailMap.get(id) || '',
      discord_username: discordMap.get(id) || null,
      rating: best.rating,
      platform: best.platform,
      platform_username: best.platform_username,
    }))

    return NextResponse.json({ leaderboard, type })
  } catch (error) {
    console.error('Leaderboard error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
