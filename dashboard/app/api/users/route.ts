import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceRoleClient()

    // Get all users from auth.users
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers()

    if (authError) {
      console.error('Error fetching auth users:', authError)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    // Get all user settings
    const { data: settings, error: settingsError } = await supabase
      .from('user_settings')
      .select('user_id, plan, plan_expiry')

    if (settingsError) {
      console.error('Error fetching user settings:', settingsError)
    }

    // Create a map of user_id -> settings
    const settingsMap = new Map(
      (settings || []).map((s) => [s.user_id, { plan: s.plan, plan_expiry: s.plan_expiry }])
    )

    // Merge users with their settings
    const users = authUsers.users.map((user) => {
      const userSettings = settingsMap.get(user.id)
      return {
        id: user.id,
        email: user.email,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        plan: userSettings?.plan || 'free',
        plan_expiry: userSettings?.plan_expiry || null,
      }
    })

    // Sort by created_at descending (newest first)
    users.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    return NextResponse.json({ users })
  } catch (error) {
    console.error('Error in GET /api/users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, plan, planExpiry } = body

    if (!userId || !plan) {
      return NextResponse.json({ error: 'userId and plan are required' }, { status: 400 })
    }

    const validPlans = ['free', 'freetrial', 'premium', 'beta', 'lifetime']
    if (!validPlans.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Check if user_settings row exists
    const { data: existing } = await supabase
      .from('user_settings')
      .select('user_id')
      .eq('user_id', userId)
      .single()

    const updateData = {
      plan,
      plan_expiry: ['freetrial', 'premium'].includes(plan) ? planExpiry : null,
    }

    if (existing) {
      // Update existing row
      const { error } = await supabase
        .from('user_settings')
        .update(updateData)
        .eq('user_id', userId)

      if (error) {
        console.error('Error updating user settings:', error)
        return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
      }
    } else {
      // Insert new row
      const { error } = await supabase
        .from('user_settings')
        .insert({ user_id: userId, ...updateData })

      if (error) {
        console.error('Error inserting user settings:', error)
        return NextResponse.json({ error: 'Failed to create user settings' }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in PATCH /api/users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
