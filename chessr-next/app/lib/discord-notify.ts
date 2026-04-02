/**
 * Reusable Discord notification helper for the admin dashboard.
 * Sends embeds to the correct channel based on message type.
 */

import { getServiceRoleClient } from '@/lib/supabase'

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN

// Channel env vars — set in docker-compose.yml
const CHANNELS = {
  admin: process.env.DISCORD_CHANNEL_ADMIN,
  plans: process.env.DISCORD_CHANNEL_PLANS,
  discord: process.env.DISCORD_CHANNEL_DISCORD,
  accounts: process.env.DISCORD_CHANNEL_ACCOUNTS,
} as const

type ChannelKey = keyof typeof CHANNELS

interface EmbedField {
  name: string
  value: string
  inline?: boolean
}

interface DiscordEmbed {
  title: string
  color: number
  fields: EmbedField[]
  timestamp?: string
  thumbnail?: { url: string }
  footer?: { text: string; icon_url?: string }
}

const DEFAULT_FOOTER = { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' }

/**
 * Send a Discord embed to a specific channel.
 */
export async function sendDiscordEmbed(channel: ChannelKey, embed: DiscordEmbed): Promise<void> {
  const channelId = CHANNELS[channel]
  if (!DISCORD_BOT_TOKEN || !channelId) return

  try {
    await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          ...embed,
          timestamp: embed.timestamp || new Date().toISOString(),
          footer: embed.footer || DEFAULT_FOOTER,
        }],
      }),
    })
  } catch (err) {
    console.error(`[Discord] Failed to send to #${channel}:`, err)
  }
}

/**
 * Get the admin's Discord tag for embed fields.
 * Returns `<@discord_id>` if linked, username if available, or 'Admin'.
 */
export async function getAdminTag(adminUserId: string | undefined | null): Promise<string> {
  if (!adminUserId) return 'Admin'
  try {
    const supabase = getServiceRoleClient()
    const { data } = await supabase
      .from('user_settings')
      .select('discord_id, discord_username')
      .eq('user_id', adminUserId)
      .single()
    if (data?.discord_id) return `<@${data.discord_id}>`
    if (data?.discord_username) return data.discord_username
  } catch { /* ignore */ }
  return 'Admin'
}

/**
 * Get a user's Discord mention string for embed fields.
 * Returns `<@discord_id>` if linked, or null if not.
 */
export async function getUserDiscordMention(userId: string): Promise<string | null> {
  try {
    const supabase = getServiceRoleClient()
    const { data } = await supabase
      .from('user_settings')
      .select('discord_id, discord_username')
      .eq('user_id', userId)
      .single()
    if (data?.discord_id) return `<@${data.discord_id}>`
    if (data?.discord_username) return data.discord_username
    return null
  } catch {
    return null
  }
}

/**
 * Build standard user fields for an embed (email + discord mention if linked).
 */
export async function buildUserFields(
  userEmail: string,
  userId?: string | null,
): Promise<EmbedField[]> {
  const fields: EmbedField[] = [
    { name: '📧 Email', value: userEmail, inline: true },
  ]

  if (userId) {
    const mention = await getUserDiscordMention(userId)
    if (mention) {
      fields.push({ name: '🎮 Discord', value: mention, inline: true })
    }
  }

  return fields
}
