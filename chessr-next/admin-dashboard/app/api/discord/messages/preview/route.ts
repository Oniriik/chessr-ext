import { NextRequest, NextResponse } from 'next/server'

const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://chessr-discord:3100'

export async function POST(request: NextRequest) {
  try {
    const { messageLink } = await request.json()
    if (!messageLink) {
      return NextResponse.json({ error: 'Missing messageLink' }, { status: 400 })
    }

    // Parse Discord message link: https://discord.com/channels/{guildId}/{channelId}/{messageId}
    const match = messageLink.match(/channels\/(\d+)\/(\d+)\/(\d+)/)
    if (!match) {
      return NextResponse.json({ error: 'Invalid Discord message link' }, { status: 400 })
    }

    const [, , channelId, messageId] = match

    const res = await fetch(`${BOT_INTERNAL_URL}/fetch-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, messageId }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error || 'Message not found' }, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Message preview error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
