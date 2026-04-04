import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { createClient } from '@supabase/supabase-js'

// =============================================================================
// Detection logic (same as cron/scan-abuse.ts, duplicated to avoid cross-package import)
// =============================================================================

interface DetectedGroup {
  types: string[]
  reasons: string[]
  userIds: string[]
  fingerprints: string[]
  ips: { ip: string; country: string | null; country_code: string | null }[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectAbuse(supabase: any): Promise<DetectedGroup[]> {
  const [fpResult, ipResult, discordResult] = await Promise.all([
    supabase.from('user_fingerprints').select('user_id, fingerprint'),
    supabase.from('signup_ips').select('user_id, ip_address, country, country_code'),
    supabase.from('discord_freetrial_history').select('discord_id, user_id'),
  ])

  if (fpResult.error || ipResult.error || discordResult.error) {
    throw new Error('Detection query failed')
  }

  const fingerprints: { user_id: string; fingerprint: string }[] = fpResult.data || []
  const ips: { user_id: string; ip_address: string; country: string | null; country_code: string | null }[] = ipResult.data || []
  const discordHistory: { discord_id: string; user_id: string }[] = discordResult.data || []

  const fpClusters = new Map<string, Set<string>>()
  for (const row of fingerprints) {
    if (!fpClusters.has(row.fingerprint)) fpClusters.set(row.fingerprint, new Set())
    fpClusters.get(row.fingerprint)!.add(row.user_id)
  }

  const ipClusters = new Map<string, Set<string>>()
  const ipMeta = new Map<string, { country: string | null; country_code: string | null }>()
  for (const row of ips) {
    if (!ipClusters.has(row.ip_address)) ipClusters.set(row.ip_address, new Set())
    ipClusters.get(row.ip_address)!.add(row.user_id)
    if (!ipMeta.has(row.ip_address)) ipMeta.set(row.ip_address, { country: row.country, country_code: row.country_code })
  }

  const discordIds = discordHistory.map(h => h.discord_id)
  const discordClusters = new Map<string, Set<string>>()
  if (discordIds.length > 0) {
    const { data: currentLinks } = await supabase.from('user_settings').select('user_id, discord_id').in('discord_id', discordIds)
    if (currentLinks) {
      const currentMap = new Map<string, string>()
      for (const row of currentLinks) { if (row.discord_id) currentMap.set(row.discord_id, row.user_id) }
      for (const hist of discordHistory) {
        const cur = currentMap.get(hist.discord_id)
        if (cur && cur !== hist.user_id) {
          if (!discordClusters.has(hist.discord_id)) discordClusters.set(hist.discord_id, new Set())
          discordClusters.get(hist.discord_id)!.add(hist.user_id)
          discordClusters.get(hist.discord_id)!.add(cur)
        }
      }
    }
  }

  const userCountries = new Map<string, Set<string>>()
  for (const row of ips) {
    if (!row.country_code) continue
    if (!userCountries.has(row.user_id)) userCountries.set(row.user_id, new Set())
    userCountries.get(row.user_id)!.add(row.country_code)
  }

  // Union-find merge
  const userToGroup = new Map<string, string>()
  const groups = new Map<string, { userIds: Set<string>; reasons: Set<string>; fps: Set<string>; ipAddrs: Set<string> }>()

  function mergeIntoGroup(userIds: string[], reason: string, fpSet?: string[], ipSet?: string[]) {
    let groupId: string | null = null
    for (const uid of userIds) { const e = userToGroup.get(uid); if (e) { groupId = e; break } }
    if (!groupId) groupId = userIds[0]
    if (!groups.has(groupId)) groups.set(groupId, { userIds: new Set(), reasons: new Set(), fps: new Set(), ipAddrs: new Set() })
    const group = groups.get(groupId)!
    group.reasons.add(reason)
    for (const uid of userIds) {
      const old = userToGroup.get(uid)
      if (old && old !== groupId && groups.has(old)) {
        const og = groups.get(old)!
        for (const u of og.userIds) { group.userIds.add(u); userToGroup.set(u, groupId) }
        for (const r of og.reasons) group.reasons.add(r)
        for (const f of og.fps) group.fps.add(f)
        for (const i of og.ipAddrs) group.ipAddrs.add(i)
        groups.delete(old)
      }
      group.userIds.add(uid)
      userToGroup.set(uid, groupId)
    }
    if (fpSet) for (const f of fpSet) group.fps.add(f)
    if (ipSet) for (const i of ipSet) group.ipAddrs.add(i)
  }

  for (const [fp, users] of fpClusters) { if (users.size >= 2) mergeIntoGroup([...users], 'Shared Fingerprint', [fp]) }
  for (const [ip, users] of ipClusters) { if (users.size >= 2) mergeIntoGroup([...users], 'Shared IP', undefined, [ip]) }
  for (const [did, users] of discordClusters) { mergeIntoGroup([...users], `Shared Discord (${did})`) }

  const result: DetectedGroup[] = []

  // Collect VPN user IDs
  const vpnUserIds = new Set<string>()
  for (const [uid, countries] of userCountries) { if (countries.size >= 2) vpnUserIds.add(uid) }

  for (const [, group] of groups) {
    const hasVpn = [...group.userIds].some(uid => vpnUserIds.has(uid))
    const types = hasVpn ? ['multi_account', 'vpn'] : ['multi_account']
    const reasons = [...group.reasons]
    if (hasVpn) reasons.push('Multiple Countries')
    result.push({
      types,
      reasons: [...new Set(reasons)],
      userIds: [...group.userIds],
      fingerprints: [...group.fps],
      ips: [...group.ipAddrs].map(ip => ({ ip, country: ipMeta.get(ip)?.country || null, country_code: ipMeta.get(ip)?.country_code || null })),
    })
  }
  for (const [userId, countries] of userCountries) {
    if (countries.size < 2 || userToGroup.has(userId)) continue
    const userIps = ips.filter(i => i.user_id === userId).map(i => ({ ip: i.ip_address, country: i.country, country_code: i.country_code }))
    result.push({ types: ['vpn'], reasons: ['Multiple Countries'], userIds: [userId], fingerprints: [], ips: [...new Map(userIps.map(i => [i.ip, i])).values()] })
  }
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertAbuseCases(supabase: any, detected: DetectedGroup[]) {
  let created = 0, updated = 0
  const affectedUserIds: string[] = []

  const { data: existingCases } = await supabase.from('abuse_cases').select('id, types, status, reasons, user_ids, fingerprints, ips')
  const cases: { id: string; types: string[]; status: string; reasons: string[]; user_ids: string[]; fingerprints: string[]; ips: { ip: string; country: string | null; country_code: string | null }[] }[] = existingCases || []
  const matchedCaseIds = new Set<string>()

  for (const group of detected) {
    const match = cases.find(c =>
      !matchedCaseIds.has(c.id) &&
      c.user_ids.some((uid: string) => group.userIds.includes(uid))
    )

    if (match) {
      matchedCaseIds.add(match.id)
      const mergedTypes = [...new Set([...(match.types || []), ...group.types])]
      const mergedUserIds = [...new Set([...match.user_ids, ...group.userIds])]
      const mergedReasons = [...new Set([...(match.reasons || []), ...group.reasons])]
      const mergedFingerprints = [...new Set([...(match.fingerprints || []), ...group.fingerprints])]
      const existingIps: { ip: string }[] = match.ips || []
      const mergedIps = [...new Map([...existingIps, ...group.ips].map(i => [i.ip, i])).values()]

      const changed = mergedTypes.length !== (match.types || []).length ||
        mergedUserIds.length !== match.user_ids.length ||
        mergedReasons.length !== (match.reasons || []).length ||
        mergedFingerprints.length !== (match.fingerprints || []).length ||
        mergedIps.length !== existingIps.length

      if (changed) {
        const updateData: Record<string, unknown> = {
          types: mergedTypes, user_ids: mergedUserIds, reasons: mergedReasons, fingerprints: mergedFingerprints,
          ips: mergedIps, updated_at: new Date().toISOString(),
        }
        if (match.status === 'closed') { updateData.status = 'open'; updateData.closed_at = null }
        await supabase.from('abuse_cases').update(updateData).eq('id', match.id)
        updated++
        affectedUserIds.push(...group.userIds)
      }
    } else {
      await supabase.from('abuse_cases').insert({
        types: group.types, status: 'open', reasons: group.reasons,
        user_ids: group.userIds, fingerprints: group.fingerprints, ips: group.ips,
      })
      created++
      affectedUserIds.push(...group.userIds)
    }
  }
  return { created, updated, total: detected.length, affectedUserIds }
}

// =============================================================================
// Enrich cases with user details
// =============================================================================

interface AbuseNote {
  id: string
  author_id: string
  author_name: string
  message: string
  created_at: string
}

interface AbuseCase {
  id: string
  types: string[]
  status: string
  reasons: string[]
  user_ids: string[]
  fingerprints: string[]
  ips: { ip: string; country: string | null; country_code: string | null }[]
  notes: AbuseNote[]
  created_at: string
  updated_at: string
  closed_at: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enrichCases(supabase: any, cases: AbuseCase[]) {
  const allUserIds = [...new Set(cases.flatMap(c => c.user_ids))]
  if (allUserIds.length === 0) return cases.map(c => ({ ...c, users: [] }))

  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('user_id, plan, freetrial_used, discord_id, discord_username, banned, created_at')
    .in('user_id', allUserIds)

  const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 })

  const emailMap = new Map<string, { email: string; created_at: string; email_confirmed: boolean }>()
  if (authUsers) for (const u of authUsers) emailMap.set(u.id, { email: u.email || '', created_at: u.created_at, email_confirmed: !!u.email_confirmed_at })

  interface UserSetting { user_id: string; plan: string; freetrial_used: boolean; discord_id: string | null; discord_username: string | null; banned: boolean; created_at: string }
  const settings: UserSetting[] = userSettings || []
  const settingsMap = new Map<string, UserSetting>()
  for (const s of settings) settingsMap.set(s.user_id, s)

  return cases.map(c => ({
    ...c,
    users: c.user_ids.map(uid => {
      const s = settingsMap.get(uid)
      const a = emailMap.get(uid)
      return {
        id: uid,
        email: a?.email || 'unknown',
        created_at: s?.created_at || a?.created_at || '',
        plan: s?.plan || 'free',
        freetrial_used: s?.freetrial_used || false,
        discord_id: s?.discord_id || null,
        discord_username: s?.discord_username || null,
        banned: s?.banned || false,
        email_confirmed: a?.email_confirmed ?? false,
      }
    }).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
  }))
}

// =============================================================================
// Discord notification for abuse scan results
// =============================================================================

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ABUSE = process.env.DISCORD_CHANNEL_ABUSE || '1490126841493717024';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://admin.chessr.io';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendAbuseScanNotification(supabase: any, source: string, created: number, updated: number, affectedUserIds: string[]) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ABUSE) return
  if (created === 0 && updated === 0) return

  try {
    const emails: string[] = []
    const uniqueIds = [...new Set(affectedUserIds)]
    for (const uid of uniqueIds.slice(0, 20)) {
      const { data } = await supabase.auth.admin.getUserById(uid)
      if (data?.user?.email) emails.push(data.user.email)
    }

    const parts: string[] = []
    if (created > 0) parts.push(`${created} new`)
    if (updated > 0) parts.push(`${updated} updated`)
    const title = `🚨 Abuse Scan — ${parts.join(', ')}`

    const filterParam = emails.length > 0 ? `&filter=${encodeURIComponent(emails.join(','))}` : ''
    const dashboardLink = `${DASHBOARD_URL}/?tab=abuse${filterParam}`

    const fields: { name: string; value: string; inline: boolean }[] = [
      { name: '📡 Source', value: source, inline: true },
      { name: '🆕 Created', value: String(created), inline: true },
      { name: '🔄 Updated', value: String(updated), inline: true },
    ]
    fields.push({ name: '🔗 Dashboard', value: `[View abuse cases](${dashboardLink})`, inline: false })

    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ABUSE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      body: JSON.stringify({
        embeds: [{
          title,
          color: created > 0 ? 0xef4444 : 0xffa500,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' },
        }],
      }),
    })
  } catch (e) {
    console.error('[Discord] Failed to send abuse scan notification:', e)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendCaseStatusNotification(supabase: any, caseId: string, status: string, adminId?: string) {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ABUSE) return

  try {
    // Fetch case details
    const { data: abuseCase } = await supabase.from('abuse_cases').select('*').eq('id', caseId).single()
    if (!abuseCase) return

    // Resolve admin identity
    let adminDisplay = 'Unknown'
    if (adminId) {
      const { data: adminSettings } = await supabase.from('user_settings').select('discord_id').eq('user_id', adminId).single()
      if (adminSettings?.discord_id) {
        adminDisplay = `<@${adminSettings.discord_id}>`
      } else {
        const { data: authData } = await supabase.auth.admin.getUserById(adminId)
        adminDisplay = authData?.user?.email || adminId
      }
    }

    const isClosed = status === 'closed'
    const title = isClosed ? '✅ Abuse Case Closed' : '🔄 Abuse Case Reopened'
    const color = isClosed ? 0x10b981 : 0xffa500

    const types = (abuseCase.types || []).map((t: string) => t === 'multi_account' ? 'Multi-Account' : 'VPN Usage').join(', ')

    // Resolve emails for dashboard link
    const userIds: string[] = abuseCase.user_ids || []
    const emails: string[] = []
    for (const uid of userIds.slice(0, 10)) {
      const { data } = await supabase.auth.admin.getUserById(uid)
      if (data?.user?.email) emails.push(data.user.email)
    }

    const filterParam = emails.length > 0 ? `&filter=${encodeURIComponent(emails.join(','))}` : ''
    const dashboardLink = `${DASHBOARD_URL}/?tab=abuse${filterParam}`

    const fields: { name: string; value: string; inline: boolean }[] = [
      { name: isClosed ? '👤 Closed by' : '👤 Reopened by', value: adminDisplay, inline: true },
      { name: '📋 Type', value: types || 'Unknown', inline: true },
      { name: '👥 Accounts', value: `${userIds.length} users`, inline: true },
    ]

    // Add notes if any
    const notes: AbuseNote[] = abuseCase.notes || []
    if (notes.length > 0) {
      const noteLines = notes.slice(0, 5).map((n: AbuseNote) => `• **${n.author_name}**: "${n.message}"`)
      if (notes.length > 5) noteLines.push(`...and ${notes.length - 5} more`)
      fields.push({ name: '📝 Notes', value: noteLines.join('\n'), inline: false })
    }

    fields.push({ name: '🔗 Dashboard', value: `[View case](${dashboardLink})`, inline: false })

    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ABUSE}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      body: JSON.stringify({
        embeds: [{ title, color, fields, timestamp: new Date().toISOString(), footer: { text: 'Chessr.io', icon_url: 'https://chessr.io/chessr-logo.png' } }],
      }),
    })
  } catch (e) {
    console.error('[Discord] Failed to send case status notification:', e)
  }
}

// =============================================================================
// GET — Read persisted cases from DB
// =============================================================================

export async function GET() {
  try {
    const supabase = getServiceRoleClient()

    const { data, error } = await supabase
      .from('abuse_cases')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const enriched = await enrichCases(supabase, data || [])
    return NextResponse.json({ groups: enriched })
  } catch (error) {
    console.error('GET abuse error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// =============================================================================
// POST — Trigger abuse scan
// =============================================================================

export async function POST() {
  try {
    const supabase = getServiceRoleClient()

    const detected = await detectAbuse(supabase)
    const result = await upsertAbuseCases(supabase, detected)

    // Send Discord notification (non-blocking)
    sendAbuseScanNotification(supabase, 'Dashboard', result.created, result.updated, result.affectedUserIds).catch(() => {})

    // Return updated list
    const { data } = await supabase
      .from('abuse_cases')
      .select('*')
      .order('updated_at', { ascending: false })

    const enriched = await enrichCases(supabase, data || [])
    return NextResponse.json({ ...result, groups: enriched })
  } catch (error) {
    console.error('POST abuse scan error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// =============================================================================
// PATCH — Close/reopen case, add note, delete note
// =============================================================================

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, action } = body
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const supabase = getServiceRoleClient()

    // Close or reopen
    if (action === 'set_status') {
      const { status, admin_id } = body
      if (!['open', 'closed'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      }
      const updateData: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
      if (status === 'closed') updateData.closed_at = new Date().toISOString()
      else updateData.closed_at = null

      const { error } = await supabase.from('abuse_cases').update(updateData).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      // Send Discord notification (non-blocking)
      sendCaseStatusNotification(supabase, id, status, admin_id).catch(() => {})

      return NextResponse.json({ success: true })
    }

    // Add note
    if (action === 'add_note') {
      const { author_id, author_name, message } = body
      if (!author_id || !message) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

      const { data: existing } = await supabase.from('abuse_cases').select('notes').eq('id', id).single()
      const notes: AbuseNote[] = existing?.notes || []
      notes.push({
        id: crypto.randomUUID(),
        author_id,
        author_name: author_name || author_id,
        message,
        created_at: new Date().toISOString(),
      })

      const { error } = await supabase.from('abuse_cases').update({ notes, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, notes })
    }

    // Delete note (only own notes)
    if (action === 'delete_note') {
      const { note_id, author_id } = body
      if (!note_id || !author_id) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

      const { data: existing } = await supabase.from('abuse_cases').select('notes').eq('id', id).single()
      const notes: AbuseNote[] = existing?.notes || []
      const note = notes.find(n => n.id === note_id)
      if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })
      if (note.author_id !== author_id) return NextResponse.json({ error: 'Can only delete your own notes' }, { status: 403 })

      const filtered = notes.filter(n => n.id !== note_id)
      const { error } = await supabase.from('abuse_cases').update({ notes: filtered, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, notes: filtered })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('PATCH abuse error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
