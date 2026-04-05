import { NextResponse } from 'next/server'

const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://chessr-discord:3100'

export async function POST(request: Request) {
  try {
    const { discordId, abuseTypes, dashboardLink } = await request.json()

    if (!discordId) {
      return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })
    }

    const res = await fetch(`${BOT_INTERNAL_URL}/create-abuse-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordId, abuseTypes, dashboardLink }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error || 'Failed to create ticket' }, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Create abuse ticket error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
