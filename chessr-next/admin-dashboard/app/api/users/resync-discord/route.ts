import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { PLAN_ROLES, ELO_BRACKETS, PLAN_NAMES } from '@/lib/discord-constants'

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

export async function POST(request: Request) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
      return NextResponse.json({ error: 'Discord not configured' }, { status: 500 })
    }

    const supabase = getServiceRoleClient()

    // Get user settings
    const { data: settings } = await supabase
      .from('user_settings')
      .select('user_id, plan, discord_id, discord_username')
      .eq('user_id', userId)
      .single()

    if (!settings) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if (!settings.discord_id) {
      return NextResponse.json({ error: 'No Discord account linked' }, { status: 400 })
    }

    // Fetch guild member
    const memberRes = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${settings.discord_id}`,
      { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
    )

    if (!memberRes.ok) {
      // Update discord_in_guild to false
      await supabase
        .from('user_settings')
        .update({ discord_in_guild: false })
        .eq('user_id', userId)

      return NextResponse.json({
        success: false,
        inGuild: false,
        message: 'User is not in the Discord server',
      })
    }

    // Mark as in guild
    await supabase
      .from('user_settings')
      .update({ discord_in_guild: true })
      .eq('user_id', userId)

    const member = await memberRes.json()
    const currentRoles: string[] = member.roles || []
    const allPlanRoleIds = Object.values(PLAN_ROLES)
    const allEloRoleIds = ELO_BRACKETS.map((b) => b.roleId)

    // --- Plan role ---
    const targetPlanRole = PLAN_ROLES[settings.plan]
    const planRolesToRemove = currentRoles.filter((r) => allPlanRoleIds.includes(r) && r !== targetPlanRole)
    const planRolesToAdd = targetPlanRole && !currentRoles.includes(targetPlanRole) ? [targetPlanRole] : []

    // --- ELO role ---
    const { data: accounts } = await supabase
      .from('linked_accounts')
      .select('rating_bullet, rating_blitz, rating_rapid')
      .eq('user_id', userId)
      .is('unlinked_at', null)

    let targetEloRole: string | null = null
    let highestElo = 0
    let eloBracketName = ''

    if (accounts && accounts.length > 0) {
      highestElo = Math.max(
        ...accounts.flatMap((a) => [a.rating_bullet ?? 0, a.rating_blitz ?? 0, a.rating_rapid ?? 0]),
      )
      if (highestElo > 0) {
        const bracket = ELO_BRACKETS.find((b) => highestElo <= b.maxElo)
        if (bracket) {
          targetEloRole = bracket.roleId
          eloBracketName = bracket.name
        }
      }
    }

    const eloRolesToRemove = currentRoles.filter((r) => allEloRoleIds.includes(r) && r !== targetEloRole)
    const eloRolesToAdd = targetEloRole && !currentRoles.includes(targetEloRole) ? [targetEloRole] : []

    // Apply changes
    const toRemove = [...planRolesToRemove, ...eloRolesToRemove]
    const toAdd = [...planRolesToAdd, ...eloRolesToAdd]

    for (const roleId of toRemove) {
      await fetch(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${settings.discord_id}/roles/${roleId}`,
        { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
      )
    }
    for (const roleId of toAdd) {
      await fetch(
        `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${settings.discord_id}/roles/${roleId}`,
        { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
      )
    }

    // Update sync timestamp
    await supabase
      .from('user_settings')
      .update({ discord_roles_synced_at: new Date().toISOString() })
      .eq('user_id', userId)

    return NextResponse.json({
      success: true,
      inGuild: true,
      rolesAdded: toAdd.length,
      rolesRemoved: toRemove.length,
      plan: PLAN_NAMES[settings.plan] || settings.plan,
      elo: highestElo > 0 ? `${highestElo} (${eloBracketName})` : null,
      message: toAdd.length === 0 && toRemove.length === 0
        ? 'Roles already in sync'
        : `Synced: +${toAdd.length} -${toRemove.length} roles`,
    })
  } catch (error) {
    console.error('Resync Discord error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
