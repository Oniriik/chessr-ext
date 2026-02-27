import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

/**
 * GET /api/linked-accounts?userId=xxx
 * Get all linked accounts for a user (including unlinked ones with cooldown)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    const { data, error } = await supabase
      .from('linked_accounts')
      .select('*')
      .eq('user_id', userId)
      .order('linked_at', { ascending: false })

    if (error) {
      console.error('Error fetching linked accounts:', error)
      return NextResponse.json({ error: 'Failed to fetch linked accounts' }, { status: 500 })
    }

    // Separate active and unlinked accounts
    const active = data?.filter((a) => !a.unlinked_at) || []
    const unlinked = data?.filter((a) => a.unlinked_at) || []

    // Calculate cooldown for unlinked accounts
    const unlinkedWithCooldown = unlinked.map((account) => {
      const unlinkedAt = new Date(account.unlinked_at)
      const hoursSince = (Date.now() - unlinkedAt.getTime()) / (1000 * 60 * 60)
      const hasCooldown = hoursSince < 48
      const hoursRemaining = hasCooldown ? Math.ceil(48 - hoursSince) : 0

      return {
        ...account,
        hasCooldown,
        hoursRemaining,
      }
    })

    // Fetch Discord info from user_settings
    const { data: settings } = await supabase
      .from('user_settings')
      .select('discord_id, discord_username, discord_avatar, discord_linked_at')
      .eq('user_id', userId)
      .single()

    const discord = settings?.discord_id
      ? {
          discord_id: settings.discord_id,
          discord_username: settings.discord_username,
          discord_avatar: settings.discord_avatar,
          discord_linked_at: settings.discord_linked_at,
        }
      : null

    return NextResponse.json({
      active,
      unlinked: unlinkedWithCooldown,
      totalActive: active.length,
      totalUnlinked: unlinked.length,
      discord,
    })
  } catch (error) {
    console.error('GET linked-accounts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/linked-accounts
 * Unlink an active account (set unlinked_at to now)
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { accountId, type, userId } = body

    const supabase = getServiceRoleClient()

    // Unlink Discord account
    if (type === 'discord' && userId) {
      const { error } = await supabase
        .from('user_settings')
        .update({
          discord_id: null,
          discord_username: null,
          discord_avatar: null,
          discord_linked_at: null,
          discord_in_guild: false,
        })
        .eq('user_id', userId)

      if (error) {
        console.error('Error unlinking Discord:', error)
        return NextResponse.json({ error: 'Failed to unlink Discord' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    // Unlink chess account
    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    // Set unlinked_at to now for active accounts
    const { error } = await supabase
      .from('linked_accounts')
      .update({ unlinked_at: new Date().toISOString() })
      .eq('id', accountId)
      .is('unlinked_at', null)

    if (error) {
      console.error('Error unlinking account:', error)
      return NextResponse.json({ error: 'Failed to unlink account' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('PATCH linked-accounts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/linked-accounts
 * Remove cooldown by deleting the unlinked account record
 */
export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { accountId } = body

    if (!accountId) {
      return NextResponse.json({ error: 'accountId is required' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Only delete records that have unlinked_at set (i.e., already unlinked)
    const { error } = await supabase
      .from('linked_accounts')
      .delete()
      .eq('id', accountId)
      .not('unlinked_at', 'is', null)

    if (error) {
      console.error('Error deleting linked account:', error)
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE linked-accounts error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
