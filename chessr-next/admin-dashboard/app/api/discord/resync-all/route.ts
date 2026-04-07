import { getServiceRoleClient } from '@/lib/supabase'
import { PLAN_ROLES, ELO_BRACKETS, PLAN_NAMES } from '@/lib/discord-constants'
import { sendDiscordEmbed } from '@/lib/discord-notify'

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

// Force Node.js runtime for proper streaming
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getRoleName(roleId: string) {
  const plan = Object.entries(PLAN_ROLES).find(([, id]) => id === roleId)
  if (plan) return PLAN_NAMES[plan[0]] || plan[0]
  const elo = ELO_BRACKETS.find((b) => b.roleId === roleId)
  if (elo) return elo.name
  return roleId
}

export async function POST() {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    return new Response(JSON.stringify({ error: 'Discord not configured' }), { status: 500 })
  }

  const supabase = getServiceRoleClient()

  const { data: linkedUsers } = await supabase
    .from('user_settings')
    .select('user_id, plan, discord_id, discord_username')
    .not('discord_id', 'is', null)

  if (!linkedUsers || linkedUsers.length === 0) {
    return new Response(JSON.stringify({ error: 'No linked users found' }), { status: 404 })
  }

  const allPlanRoleIds = Object.values(PLAN_ROLES)
  const allEloRoleIds = ELO_BRACKETS.map((b) => b.roleId)

  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  const send = async (data: Record<string, unknown>) => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
  }

  // Run the sync in the background, writing to the stream
  ;(async () => {
    try {
      await send({ type: 'start', total: linkedUsers.length })

      let synced = 0
      let changed = 0
      let notInGuild = 0
      let errors = 0
      const changes: { user: string; added: string[]; removed: string[] }[] = []

      for (let i = 0; i < linkedUsers.length; i++) {
        const user = linkedUsers[i]
        try {
          const memberRes = await fetch(
            `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${user.discord_id}`,
            { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
          )

          if (!memberRes.ok) {
            await supabase
              .from('user_settings')
              .update({ discord_in_guild: false })
              .eq('user_id', user.user_id)
            notInGuild++
            await send({ type: 'progress', current: i + 1, total: linkedUsers.length, user: user.discord_username, status: 'not_in_guild' })
            await new Promise((r) => setTimeout(r, 300))
            continue
          }

          await supabase
            .from('user_settings')
            .update({ discord_in_guild: true })
            .eq('user_id', user.user_id)

          const member = await memberRes.json()
          const currentRoles: string[] = member.roles || []

          const targetPlanRole = PLAN_ROLES[user.plan]
          const planToRemove = currentRoles.filter((r) => allPlanRoleIds.includes(r) && r !== targetPlanRole)
          const planToAdd = targetPlanRole && !currentRoles.includes(targetPlanRole) ? [targetPlanRole] : []

          const { data: accounts } = await supabase
            .from('linked_accounts')
            .select('rating_bullet, rating_blitz, rating_rapid')
            .eq('user_id', user.user_id)
            .is('unlinked_at', null)

          let targetEloRole: string | null = null
          if (accounts && accounts.length > 0) {
            const highestElo = Math.max(
              ...accounts.flatMap((a) => [a.rating_bullet ?? 0, a.rating_blitz ?? 0, a.rating_rapid ?? 0]),
            )
            if (highestElo > 0) {
              const bracket = ELO_BRACKETS.find((b) => highestElo <= b.maxElo)
              if (bracket) targetEloRole = bracket.roleId
            }
          }

          const eloToRemove = currentRoles.filter((r) => allEloRoleIds.includes(r) && r !== targetEloRole)
          const eloToAdd = targetEloRole && !currentRoles.includes(targetEloRole) ? [targetEloRole] : []

          const toRemove = [...planToRemove, ...eloToRemove]
          const toAdd = [...planToAdd, ...eloToAdd]

          for (const roleId of toRemove) {
            await fetch(
              `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${user.discord_id}/roles/${roleId}`,
              { method: 'DELETE', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
            )
          }
          for (const roleId of toAdd) {
            await fetch(
              `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${user.discord_id}/roles/${roleId}`,
              { method: 'PUT', headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } },
            )
          }

          await supabase
            .from('user_settings')
            .update({ discord_roles_synced_at: new Date().toISOString() })
            .eq('user_id', user.user_id)

          synced++

          if (toAdd.length > 0 || toRemove.length > 0) {
            changed++
            changes.push({
              user: user.discord_username || user.discord_id,
              added: toAdd.map(getRoleName),
              removed: toRemove.map(getRoleName),
            })

            const fields = [
              { name: '🎮 Discord', value: `<@${user.discord_id}>`, inline: true },
            ]
            if (toRemove.length > 0) {
              fields.push({ name: '❌ Removed', value: toRemove.map(getRoleName).join(', '), inline: true })
            }
            if (toAdd.length > 0) {
              fields.push({ name: '✅ Added', value: toAdd.map(getRoleName).join(', '), inline: true })
            }

            await sendDiscordEmbed('discord', {
              title: '🔄 Role Update',
              color: 0xffa500,
              fields,
            })

            await send({ type: 'progress', current: i + 1, total: linkedUsers.length, user: user.discord_username, status: 'changed', added: toAdd.map(getRoleName), removed: toRemove.map(getRoleName) })
          } else {
            await send({ type: 'progress', current: i + 1, total: linkedUsers.length, user: user.discord_username, status: 'ok' })
          }

          await new Promise((r) => setTimeout(r, 300))
        } catch (err) {
          errors++
          await send({ type: 'progress', current: i + 1, total: linkedUsers.length, user: user.discord_username, status: 'error', error: String(err) })
        }
      }

      if (changed > 0) {
        const summaryLines = changes.map(
          (c) => `**${c.user}**: ${c.added.length > 0 ? `+${c.added.join(', ')}` : ''}${c.removed.length > 0 ? ` -${c.removed.join(', ')}` : ''}`,
        )
        await sendDiscordEmbed('discord', {
          title: '📋 Bulk Role Sync Complete',
          color: 0x3b82f6,
          fields: [
            { name: '📊 Stats', value: `${synced} synced, ${changed} changed, ${notInGuild} not in server, ${errors} errors`, inline: false },
            { name: '🔄 Changes', value: summaryLines.join('\n').slice(0, 1024) || 'None', inline: false },
          ],
        })
      }

      await send({ type: 'done', synced, changed, notInGuild, errors, changes })
    } finally {
      await writer.close()
    }
  })()

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
