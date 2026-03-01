import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServiceRoleClient } from '@/lib/supabase'
import { canModifyRoles, canModifyPlans, type UserRole, type UserPlan } from '@/lib/types'
import { PLAN_ROLES } from '@/lib/discord-constants'
import { sendDiscordEmbed, getAdminTag, buildUserFields } from '@/lib/discord-notify'

const VALID_PLANS: UserPlan[] = ['free', 'freetrial', 'premium', 'beta', 'lifetime']
const VALID_ROLES: UserRole[] = ['super_admin', 'admin', 'user']

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

async function syncDiscordRoles(discordId: string, newPlan: string, oldPlan: string, userEmail: string, userId: string, adminUserId?: string | null) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) return

  try {
    // Fetch guild member
    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
    )
    if (!memberRes.ok) return

    const member = await memberRes.json()
    const currentRoles: string[] = member.roles || []
    const allPlanRoleIds = Object.values(PLAN_ROLES)

    // Remove old plan roles, add new one
    const newRoleId = PLAN_ROLES[newPlan]
    const rolesToRemove = currentRoles.filter((r: string) => allPlanRoleIds.includes(r) && r !== newRoleId)
    const rolesToAdd = newRoleId && !currentRoles.includes(newRoleId) ? [newRoleId] : []

    for (const roleId of rolesToRemove) {
      await fetch(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      )
    }
    for (const roleId of rolesToAdd) {
      await fetch(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      )
    }

    // Send plan change notification to #plan-infos
    if (rolesToRemove.length > 0 || rolesToAdd.length > 0) {
      const planName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1)
      const adminTag = await getAdminTag(adminUserId)
      const userFields = await buildUserFields(userEmail, userId)
      await sendDiscordEmbed('plans', {
        title: '🔄 Plan Changed',
        color: 0xffa500,
        fields: [
          ...userFields,
          { name: '❌ Old Plan', value: planName(oldPlan), inline: true },
          { name: '✅ New Plan', value: planName(newPlan), inline: true },
          { name: '👤 Admin', value: adminTag, inline: true },
        ],
      })
    }
  } catch (err) {
    console.error('[Discord] Failed to sync roles:', err)
  }
}

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
    const emailMap = new Map<string, { email: string; created_at: string; last_sign_in_at: string | null; email_confirmed: boolean }>()
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
          email_confirmed: !!user.email_confirmed_at,
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
          email_confirmed: authInfo?.email_confirmed ?? false,
          linked_count: linkedCountMap.get(settings.user_id) || 0,
          has_discord: !!settings.discord_id,
          last_activity: null as string | null,
          banned: settings.banned || false,
          ban_reason: settings.ban_reason || null,
          banned_at: settings.banned_at || null,
          banned_by: settings.banned_by || null,
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
    const { userId, callerRole, plan, role, planExpiry, adminUserId, adminEmail, userEmail, banned, banReason } = body

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
    if (banned !== undefined) {
      updateData.banned = banned
      updateData.ban_reason = banned ? (banReason || null) : null
      updateData.banned_at = banned ? new Date().toISOString() : null
      updateData.banned_by = banned ? (adminEmail || null) : null
      if (banned) {
        updateData.plan = 'free'
        updateData.plan_expiry = null
      }
    }

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

          if (insertData?.discord_id) {
            syncDiscordRoles(insertData.discord_id, plan, 'free', userEmail || 'unknown', userId, adminUserId).catch(() => {})
          }
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

      // Sync Discord roles if user has Discord linked
      if (data?.discord_id) {
        syncDiscordRoles(data.discord_id, plan, oldPlan, userEmail || 'unknown', userId, adminUserId).catch(() => {})
      }
    }

    // Log ban/unban action
    if (banned !== undefined) {
      // On ban: unlink all chess accounts
      if (banned) {
        await supabase
          .from('linked_accounts')
          .update({ unlinked_at: new Date().toISOString() })
          .eq('user_id', userId)
          .is('unlinked_at', null)
      }

      await supabase.from('plan_activity_logs').insert({
        user_id: userId,
        user_email: userEmail || null,
        action_type: banned ? 'user_ban' : 'user_unban',
        admin_user_id: adminUserId || null,
        admin_email: adminEmail || null,
        old_plan: oldPlan,
        new_plan: banned ? 'free' : oldPlan,
        reason: banned
          ? (banReason ? `${banReason} (by ${adminEmail || 'admin'})` : `Banned by ${adminEmail || 'admin'}`)
          : `Unbanned by ${adminEmail || 'admin'}`,
      })

      // Sync Discord roles (plan changed to free on ban)
      if (data?.discord_id && banned) {
        syncDiscordRoles(data.discord_id, 'free', oldPlan, userEmail || 'unknown', userId, adminUserId).catch(() => {})
      }

      // Discord notification to #admin-logs
      const adminTag = await getAdminTag(adminUserId)
      const userFields = await buildUserFields(userEmail || 'unknown', userId)
      const fields = [
        ...userFields,
        { name: '👤 Admin', value: adminTag, inline: true },
      ]
      if (banned && banReason) {
        fields.push({ name: '📝 Reason', value: banReason, inline: false })
      }
      await sendDiscordEmbed('admin', {
        title: banned ? '🚫 User Banned' : '✅ User Unbanned',
        color: banned ? 0xef4444 : 0x10b981,
        fields,
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('PATCH users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { userId, adminEmail, adminPassword, callerRole } = body

    if (!userId || !adminEmail || !adminPassword) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!canModifyPlans(callerRole)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const supabase = getServiceRoleClient()

    // Verify admin password by attempting sign-in
    const anonClient = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    const { error: authError } = await anonClient.auth.signInWithPassword({
      email: adminEmail,
      password: adminPassword,
    })

    if (authError) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Get user info for logging
    const { data: authUser } = await supabase.auth.admin.getUserById(userId)
    const targetEmail = authUser?.user?.email || 'unknown'

    // Get current plan for the log
    const { data: currentSettings } = await supabase
      .from('user_settings')
      .select('plan')
      .eq('user_id', userId)
      .single()

    // Find admin user_id from email for Discord tag
    const { data: adminAuthList } = await supabase.auth.admin.listUsers({ perPage: 1000 })
    const adminUser = adminAuthList?.users.find(u => u.email === adminEmail)
    const adminUserId = adminUser?.id || null

    // Log the deletion before removing data
    await supabase.from('plan_activity_logs').insert({
      user_id: userId,
      user_email: targetEmail,
      action_type: 'account_delete',
      admin_user_id: adminUserId,
      admin_email: adminEmail,
      old_plan: currentSettings?.plan || 'unknown',
      new_plan: 'deleted',
      reason: `Account deleted by ${adminEmail}`,
    })

    // Discord notification to #admin-logs
    const adminTag = await getAdminTag(adminUserId)
    const userFields = await buildUserFields(targetEmail, userId)
    await sendDiscordEmbed('admin', {
      title: '🗑️ User Deleted',
      color: 0xef4444,
      fields: [
        ...userFields,
        { name: '📋 Plan', value: (currentSettings?.plan || 'unknown').charAt(0).toUpperCase() + (currentSettings?.plan || 'unknown').slice(1), inline: true },
        { name: '👤 Admin', value: adminTag, inline: true },
      ],
    })

    // Delete all associated data (except plan_activity_logs - kept for audit)
    const tables = [
      'user_settings',
      'user_activity',
      'linked_accounts',
      'signup_ips',
    ]

    for (const table of tables) {
      const { error } = await supabase.from(table).delete().eq('user_id', userId)
      if (error) {
        console.error(`[Delete] Failed to clear ${table}:`, error.message)
      }
    }

    // Delete the auth user (plan_activity_logs.user_id will be SET NULL)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('[Delete] Failed to delete auth user:', deleteError.message)
      return NextResponse.json({ error: 'Failed to delete auth user' }, { status: 500 })
    }

    console.log(`[Delete] User ${targetEmail} (${userId}) deleted by ${adminEmail}`)

    return NextResponse.json({ success: true, email: targetEmail })
  } catch (error) {
    console.error('DELETE users error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
