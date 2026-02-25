import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { canModifyRoles, canModifyPlans, type UserRole, type UserPlan } from '@/lib/types'

const VALID_PLANS: UserPlan[] = ['free', 'freetrial', 'premium', 'beta', 'lifetime']
const VALID_ROLES: UserRole[] = ['super_admin', 'admin', 'user']

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const search = searchParams.get('search') || ''
    const roleFilter = searchParams.get('role') || ''
    const planFilter = searchParams.get('plan') || ''

    const offset = (page - 1) * limit
    const supabase = getServiceRoleClient()

    // Get users from auth.users with their settings
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers({
      page,
      perPage: limit,
    })

    if (authError) {
      console.error('Error fetching auth users:', authError)
      return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
    }

    // Get all user settings
    let settingsQuery = supabase.from('user_settings').select('*')

    if (roleFilter) {
      settingsQuery = settingsQuery.eq('role', roleFilter)
    }
    if (planFilter) {
      settingsQuery = settingsQuery.eq('plan', planFilter)
    }

    const { data: userSettings, error: settingsError } = await settingsQuery

    if (settingsError) {
      console.error('Error fetching user settings:', settingsError)
      return NextResponse.json({ error: 'Failed to fetch user settings' }, { status: 500 })
    }

    // Create a map of user settings by user_id
    const settingsMap = new Map(userSettings?.map((s) => [s.user_id, s]) || [])

    // Get linked accounts count for all users
    const { data: linkedAccountsData } = await supabase
      .from('linked_accounts')
      .select('user_id')
      .is('unlinked_at', null)

    // Count linked accounts per user
    const linkedCountMap = new Map<string, number>()
    linkedAccountsData?.forEach((la) => {
      linkedCountMap.set(la.user_id, (linkedCountMap.get(la.user_id) || 0) + 1)
    })

    // Get last activity for all users (most recent event per user)
    const { data: activityData } = await supabase
      .from('user_activity')
      .select('user_id, created_at')
      .order('created_at', { ascending: false })

    // Get latest activity per user
    const lastActivityMap = new Map<string, string>()
    activityData?.forEach((activity) => {
      if (!lastActivityMap.has(activity.user_id)) {
        lastActivityMap.set(activity.user_id, activity.created_at)
      }
    })

    // Merge auth users with their settings
    let users = authUsers.users.map((user) => {
      const settings = settingsMap.get(user.id)
      return {
        id: settings?.id || null,
        user_id: user.id,
        email: user.email || '',
        role: (settings?.role as UserRole) || 'user',
        plan: (settings?.plan as UserPlan) || 'free',
        plan_expiry: settings?.plan_expiry || null,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at || null,
        linked_count: linkedCountMap.get(user.id) || 0,
        last_activity: lastActivityMap.get(user.id) || null,
      }
    })

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase()
      users = users.filter((u) => u.email.toLowerCase().includes(searchLower))
    }

    // Apply role filter (if not already done in query)
    if (roleFilter && !settingsMap.size) {
      users = users.filter((u) => u.role === roleFilter)
    }

    // Apply plan filter (if not already done in query)
    if (planFilter && !settingsMap.size) {
      users = users.filter((u) => u.plan === planFilter)
    }

    // Sort by created_at DESC
    users.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // Paginate
    const total = users.length
    const paginatedUsers = users.slice(offset, offset + limit)

    return NextResponse.json({
      data: paginatedUsers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    console.error('GET users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { userId, callerRole, plan, role, planExpiry } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (!callerRole) {
      return NextResponse.json({ error: 'Caller role is required' }, { status: 400 })
    }

    // Validate caller permissions
    if (role !== undefined && !canModifyRoles(callerRole)) {
      return NextResponse.json(
        { error: 'Only Super Admins can modify roles' },
        { status: 403 }
      )
    }

    if (plan !== undefined && !canModifyPlans(callerRole)) {
      return NextResponse.json(
        { error: 'You do not have permission to modify plans' },
        { status: 403 }
      )
    }

    // Validate values
    if (plan && !VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan value' }, { status: 400 })
    }

    if (role && !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role value' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Build update object
    const updateData: Record<string, unknown> = {}
    if (plan !== undefined) updateData.plan = plan
    if (role !== undefined) updateData.role = role
    if (planExpiry !== undefined) updateData.plan_expiry = planExpiry

    // Update user settings
    const { data, error } = await supabase
      .from('user_settings')
      .update(updateData)
      .eq('user_id', userId)
      .select()
      .single()

    if (error) {
      // If no row exists, try to insert
      if (error.code === 'PGRST116') {
        const { data: insertData, error: insertError } = await supabase
          .from('user_settings')
          .insert({
            user_id: userId,
            ...updateData,
          })
          .select()
          .single()

        if (insertError) {
          console.error('Error inserting user settings:', insertError)
          return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
        }

        return NextResponse.json(insertData)
      }

      console.error('Error updating user settings:', error)
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('PATCH users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
