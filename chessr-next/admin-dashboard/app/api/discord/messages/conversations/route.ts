import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceRoleClient()
    const discordId = request.nextUrl.searchParams.get('discordId')

    if (discordId) {
      // Get full conversation for a specific user
      const [{ data: sent }, { data: received }] = await Promise.all([
        supabase
          .from('dm_sent')
          .select('*')
          .eq('discord_id', discordId)
          .order('created_at', { ascending: true }),
        supabase
          .from('dm_responses')
          .select('*')
          .eq('discord_id', discordId)
          .order('created_at', { ascending: true }),
      ])

      const messages = [
        ...(sent || []).map(m => ({ ...m, direction: 'outgoing' as const })),
        ...(received || []).map(m => ({ ...m, direction: 'incoming' as const })),
      ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      return NextResponse.json({ messages })
    }

    // List all conversations (grouped by user, latest message first)
    const [{ data: sent }, { data: received }] = await Promise.all([
      supabase
        .from('dm_sent')
        .select('discord_id, discord_username, content, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('dm_responses')
        .select('discord_id, discord_username, content, created_at')
        .order('created_at', { ascending: false }),
    ])

    // Group by user, find latest message and count
    const userMap = new Map<string, {
      discord_id: string
      discord_username: string
      lastMessage: string
      lastAt: string
      sentCount: number
      receivedCount: number
    }>()

    for (const m of (sent || [])) {
      const existing = userMap.get(m.discord_id)
      if (!existing) {
        userMap.set(m.discord_id, {
          discord_id: m.discord_id,
          discord_username: m.discord_username,
          lastMessage: m.content,
          lastAt: m.created_at,
          sentCount: 1,
          receivedCount: 0,
        })
      } else {
        existing.sentCount++
        if (new Date(m.created_at) > new Date(existing.lastAt)) {
          existing.lastMessage = m.content
          existing.lastAt = m.created_at
        }
      }
    }

    for (const m of (received || [])) {
      const existing = userMap.get(m.discord_id)
      if (!existing) {
        userMap.set(m.discord_id, {
          discord_id: m.discord_id,
          discord_username: m.discord_username,
          lastMessage: m.content,
          lastAt: m.created_at,
          sentCount: 0,
          receivedCount: 1,
        })
      } else {
        existing.receivedCount++
        if (new Date(m.created_at) > new Date(existing.lastAt)) {
          existing.lastMessage = m.content
          existing.lastAt = m.created_at
        }
      }
    }

    const conversations = Array.from(userMap.values())
      .sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime())

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('Conversations error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
