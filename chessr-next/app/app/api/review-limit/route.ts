import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (!token) {
    return NextResponse.json({ isLimited: false, dailyUsage: 0, dailyLimit: null })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ isLimited: false, dailyUsage: 0, dailyLimit: null })
  }

  try {
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ isLimited: false, dailyUsage: 0, dailyLimit: null })
    }

    // Get user plan
    const { data: settings } = await supabase
      .from('user_settings')
      .select('plan')
      .eq('user_id', user.id)
      .single()

    const plan = settings?.plan || 'free'
    const isPremium = plan === 'premium' || plan === 'lifetime' || plan === 'beta' || plan === 'freetrial'

    if (isPremium) {
      return NextResponse.json({ isLimited: false, dailyUsage: 0, dailyLimit: null })
    }

    // Count today's reviews
    const DAILY_LIMIT = 5
    const todayUTC = new Date()
    todayUTC.setUTCHours(0, 0, 0, 0)

    const { count } = await supabase
      .from('user_activity')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('event_type', 'game_review')
      .gte('created_at', todayUTC.toISOString())

    return NextResponse.json({
      isLimited: true,
      dailyUsage: count || 0,
      dailyLimit: DAILY_LIMIT,
    })
  } catch {
    return NextResponse.json({ isLimited: false, dailyUsage: 0, dailyLimit: null })
  }
}
