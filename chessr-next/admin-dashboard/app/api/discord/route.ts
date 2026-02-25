import { NextResponse } from 'next/server'

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID
const DISCORD_STATS_CATEGORY_ID = process.env.DISCORD_STATS_CHANNEL_ID // Category ID for stats channels

// Predefined embed templates
const templates = {
  maintenance: {
    title: '🔧 Maintenance en cours',
    description: 'Le serveur Chessr est actuellement en maintenance. Nous serons de retour bientôt !',
    color: 0xffa500, // Orange
  },
  maintenanceEnd: {
    title: '✅ Maintenance terminée',
    description: 'Le serveur Chessr est de nouveau opérationnel. Bon jeu !',
    color: 0x00ff00, // Green
  },
  update: {
    title: '🚀 Nouvelle mise à jour',
    description: '',
    color: 0x5865f2, // Discord blue
  },
  announcement: {
    title: '📢 Annonce',
    description: '',
    color: 0x5865f2,
  },
}

// Update the status voice channel name
async function updateStatusChannel(maintenance: boolean): Promise<boolean> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !DISCORD_STATS_CATEGORY_ID) {
    console.log('Status channel update skipped: missing config')
    return false
  }

  try {
    // Fetch all channels in the guild
    const response = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/channels`,
      {
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      console.error('Failed to fetch channels for status update')
      return false
    }

    const channels = await response.json()

    // Find the status voice channel in the stats category
    const statusChannel = channels.find(
      (c: { parent_id: string | null; type: number; name: string }) =>
        c.parent_id === DISCORD_STATS_CATEGORY_ID &&
        c.type === 2 && // Voice channel
        /status/i.test(c.name)
    )

    if (!statusChannel) {
      console.log('Status channel not found')
      return false
    }

    // Update the channel name
    const newName = maintenance ? '🟡 Status: Maintenance' : '🟢 Status: Working'

    const updateResponse = await fetch(
      `https://discord.com/api/v10/channels/${statusChannel.id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      }
    )

    if (!updateResponse.ok) {
      const error = await updateResponse.text()
      console.error('Failed to update status channel:', error)
      return false
    }

    console.log(`Status channel updated to: ${newName}`)
    return true
  } catch (error) {
    console.error('Error updating status channel:', error)
    return false
  }
}

// GET - Fetch Discord channels
export async function GET() {
  try {
    if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
      return NextResponse.json({ error: 'Discord not configured' }, { status: 500 })
    }

    const response = await fetch(
      `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/channels`,
      {
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('Discord API error:', error)
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
    }

    const channels = await response.json()

    // Filter to text and announcement channels
    const textChannels = channels
      .filter((c: { type: number }) => c.type === 0 || c.type === 5) // 0 = text, 5 = announcement
      .map((c: { id: string; name: string; parent_id: string | null; type: number }) => ({
        id: c.id,
        name: c.name,
        parentId: c.parent_id,
        type: c.type === 5 ? 'announcement' : 'text',
      }))

    return NextResponse.json({ channels: textChannels })
  } catch (error) {
    console.error('GET discord error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Send embed message or update status
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { channelId, template, title, description, color, useWebhook, pingEveryone, statusOnly } = body

    // If statusOnly, just update the status channel without sending a message
    if (statusOnly && (template === 'maintenance' || template === 'maintenanceEnd')) {
      const statusUpdated = await updateStatusChannel(template === 'maintenance')
      if (statusUpdated) {
        return NextResponse.json({ success: true, statusUpdated: true })
      } else {
        return NextResponse.json({ error: 'Failed to update status channel' }, { status: 500 })
      }
    }

    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID required' }, { status: 400 })
    }

    // Build embed
    const embed = {
      title: title || templates[template as keyof typeof templates]?.title || 'Message',
      description: description || templates[template as keyof typeof templates]?.description || '',
      color: color || templates[template as keyof typeof templates]?.color || 0x5865f2,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Chessr Admin',
        icon_url: 'https://chessr.io/chessr-logo.png',
      },
    }

    // Build message payload with optional @everyone ping
    const messagePayload: { content?: string; embeds: typeof embed[] } = {
      embeds: [embed],
    }

    if (pingEveryone) {
      messagePayload.content = '@everyone'
    }

    // Use webhook if configured and requested
    if (useWebhook && DISCORD_WEBHOOK_URL) {
      const response = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messagePayload),
      })

      if (!response.ok) {
        return NextResponse.json({ error: 'Webhook failed' }, { status: 500 })
      }

      return NextResponse.json({ success: true, method: 'webhook' })
    }

    // Use bot to send to specific channel
    if (!DISCORD_BOT_TOKEN) {
      return NextResponse.json({ error: 'Bot not configured' }, { status: 500 })
    }

    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messagePayload),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('Discord send error:', error)
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    return NextResponse.json({ success: true, method: 'bot' })
  } catch (error) {
    console.error('POST discord error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
