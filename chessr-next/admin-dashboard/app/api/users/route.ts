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
    const search = searchParams.get('search')?.trim() || ''
    const roleFilter = searchParams.get('role') || ''
    const planFilter = searchParams.get('plan') || ''
    const sortBy = searchParams.get('sortBy') || 'created_at'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    const offset = (page - 1) * limit
    const supabase = getServiceRoleClient()

    // First, get ALL auth users to build email map
    // We need to paginate through all users to get their emails
    const emailMap = new Map<string, { email: string; created_at: string; last_sign_in_at: string | null }>()
    let authPage = 1
    const authPerPage = 1000

    while (true) {
      const { data: authBatch, error: authError } = await supabase.auth.admin.listUsers({
        page: authPage,
        perPage: authPerPage,
      })

      if (authError) {
        console.error('Error fetching auth users:', authError)
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
      }

      if (!authBatch.users.length) break

      authBatch.users.forEach((user) => {
        emailMap.set(user.id, {
          email: user.email || '',
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at || null,
        })
      })

      if (authBatch.users.length < authPerPage) break
      authPage++
    }

    // Build query on user_settings with filters
    let settingsQuery = supabase.from('user_settings').select('*', { count: 'exact' })

    if (roleFilter) {
      settingsQuery = settingsQuery.eq('role', roleFilter)
    }
    if (planFilter) {
      settingsQuery = settingsQuery.eq('plan', planFilter)
    }

    // Get all matching user_settings (we'll filter by email search after)
    const { data: userSettings, error: settingsError } = await settingsQuery

    if (settingsError) {
      console.error('Error fetching user settings:', settingsError)
      return NextResponse.json({ error: 'Failed to fetch user settings' }, { status: 500 })
    }

    // Get linked accounts count for all users
    const { data: linkedAccountsData } = await supabase
      .from('linked_accounts')
      .select('user_id')
      .is('unlinked_at', null)

    const linkedCountMap = new Map<string, number>()
    linkedAccountsData?.forEach((la) => {
      linkedCountMap.set(la.user_id, (linkedCountMap.get(la.user_id) || 0) + 1)
    })

    // Build users array from settings + email map (without last_activity for now)
    let users = (userSettings || [])
      .map((settings) => {
        const authInfo = emailMap.get(settings.user_id)
        return {
          id: settings.id,
          user_id: settings.user_id,
          email: authInfo?.email || '',
          role: (settings.role as UserRole) || 'user',
          plan: (settings.plan as UserPlan) || 'free',
          plan_expiry: settings.plan_expiry || null,
          created_at: authInfo?.created_at || settings.created_at,
          last_sign_in_at: authInfo?.last_sign_in_at || null,
          linked_count: linkedCountMap.get(settings.user_id) || 0,
          last_activity: null as string | null,
        }
      })
      .filter((u) => u.email) // Only users with valid email

    // Apply email search filter
    if (search) {
      const searchLower = search.toLowerCase()
      users = users.filter((u) => u.email.toLowerCase().includes(searchLower))
    }

    // If sorting by last_activity, we need to fetch it for ALL users first
    if (sortBy === 'last_activity') {
      // Fetch last activity per user with pagination
      const allUserIds = users.map((u) => u.user_id)
      const lastActivityMap = new Map<string, string>()

      for (let i = 0; i < allUserIds.length; i += 50) {
        const batch = allUserIds.slice(i, i + 50)
        for (const uid of batch) {
          const { data: lastRow } = await supabase
            .from('user_activity')
            .select('created_at')
            .eq('user_id', uid)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()
          if (lastRow) {
            lastActivityMap.set(uid, lastRow.created_at)
          }
        }
      }

      users.forEach((u) => {
        u.last_activity = lastActivityMap.get(u.user_id) || null
      })
    }

    // Sort
    users.sort((a, b) => {
      let aValue: string | null = null
      let bValue: string | null = null

      if (sortBy === 'created_at') {
        aValue = a.created_at
        bValue = b.created_at
      } else if (sortBy === 'plan_expiry') {
        aValue = a.plan_expiry
        bValue = b.plan_expiry
      } else if (sortBy === 'last_activity') {
        aValue = a.last_activity
        bValue = b.last_activity
      }

      // Handle null values - put them at the end
      if (!aValue && !bValue) return 0
      if (!aValue) return 1
      if (!bValue) return -1

      const comparison = new Date(aValue).getTime() - new Date(bValue).getTime()
      return sortOrder === 'asc' ? comparison : -comparison
    })

    // Calculate stats from ALL filtered users (before pagination)
    const stats = {
      total: users.length,
      free: users.filter((u) => u.plan === 'free').length,
      freetrial: users.filter((u) => u.plan === 'freetrial').length,
      premium: users.filter((u) => u.plan === 'premium').length,
      beta: users.filter((u) => u.plan === 'beta').length,
      lifetime: users.filter((u) => u.plan === 'lifetime').length,
    }

    // Paginate
    const total = users.length
    const paginatedUsers = users.slice(offset, offset + limit)

    // Fetch last activity only for paginated users (if not already fetched for sorting)
    if (sortBy !== 'last_activity') {
      const pageUserIds = paginatedUsers.map((u) => u.user_id)
      for (const uid of pageUserIds) {
        const { data: lastRow } = await supabase
          .from('user_activity')
          .select('created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        const user = paginatedUsers.find((u) => u.user_id === uid)
        if (user && lastRow) {
          user.last_activity = lastRow.created_at
        }
      }
    }

    return NextResponse.json({
      data: paginatedUsers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats,
    })
  } catch (error) {
    console.error('GET users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { userId, callerRole, plan, role, planExpiry, adminUserId, adminEmail, userEmail } = body

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

    // Get current user settings for logging
    const { data: currentSettings } = await supabase
      .from('user_settings')
      .select('plan, plan_expiry')
      .eq('user_id', userId)
      .single()

    const oldPlan = currentSettings?.plan || 'free'
    const oldExpiry = currentSettings?.plan_expiry || null

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

        // Log plan change for insert
        if (plan !== undefined && plan !== 'free') {
          await supabase.from('plan_activity_logs').insert({
            user_id: userId,
            user_email: userEmail || null,
            action_type: 'admin_change',
            admin_user_id: adminUserId || null,
            admin_email: adminEmail || null,
            old_plan: 'free',
            new_plan: plan,
            old_expiry: null,
            new_expiry: planExpiry || null,
            reason: adminEmail ? `Manual change by ${adminEmail}` : 'Manual change by admin',
          })
        }

        return NextResponse.json(insertData)
      }

      console.error('Error updating user settings:', error)
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
    }

    // Log plan change if plan was modified
    if (plan !== undefined && plan !== oldPlan) {
      await supabase.from('plan_activity_logs').insert({
        user_id: userId,
        user_email: userEmail || null,
        action_type: 'admin_change',
        admin_user_id: adminUserId || null,
        admin_email: adminEmail || null,
        old_plan: oldPlan,
        new_plan: plan,
        old_expiry: oldExpiry,
        new_expiry: planExpiry !== undefined ? planExpiry : oldExpiry,
        reason: adminEmail ? `Manual change by ${adminEmail}` : 'Manual change by admin',
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('PATCH users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
