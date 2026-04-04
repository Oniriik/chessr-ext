/**
 * Scan Abuse
 * Detects multi-account and VPN abuse patterns, persists results in abuse_cases table.
 * Upserts: updates existing cases if overlapping users, creates new ones otherwise.
 * Reopens closed cases if new abuse detected.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface DetectedGroup {
  types: string[]
  reasons: string[]
  userIds: string[]
  fingerprints: string[]
  ips: { ip: string; country: string | null; country_code: string | null }[]
}

async function detectAbuse(): Promise<DetectedGroup[]> {
  // 1. Fetch all fingerprints, IPs, and Discord history in parallel
  const [fpResult, ipResult, discordResult] = await Promise.all([
    supabase.from('user_fingerprints').select('user_id, fingerprint'),
    supabase.from('signup_ips').select('user_id, ip_address, country, country_code'),
    supabase.from('discord_freetrial_history').select('discord_id, user_id'),
  ]);

  if (fpResult.error || ipResult.error || discordResult.error) {
    throw new Error(`Detection query failed: ${fpResult.error?.message || ipResult.error?.message || discordResult.error?.message}`);
  }

  const fingerprints = fpResult.data || [];
  const ips = ipResult.data || [];
  const discordHistory = discordResult.data || [];

  // 2. Build clusters

  // Fingerprint clusters
  const fpClusters = new Map<string, Set<string>>();
  for (const row of fingerprints) {
    if (!fpClusters.has(row.fingerprint)) fpClusters.set(row.fingerprint, new Set());
    fpClusters.get(row.fingerprint)!.add(row.user_id);
  }

  // IP clusters
  const ipClusters = new Map<string, Set<string>>();
  const ipMeta = new Map<string, { country: string | null; country_code: string | null }>();
  for (const row of ips) {
    if (!ipClusters.has(row.ip_address)) ipClusters.set(row.ip_address, new Set());
    ipClusters.get(row.ip_address)!.add(row.user_id);
    if (!ipMeta.has(row.ip_address)) {
      ipMeta.set(row.ip_address, { country: row.country, country_code: row.country_code });
    }
  }

  // Discord clusters
  const discordIds = discordHistory.map(h => h.discord_id);
  const discordClusters = new Map<string, Set<string>>();
  if (discordIds.length > 0) {
    const { data: currentLinks } = await supabase
      .from('user_settings')
      .select('user_id, discord_id')
      .in('discord_id', discordIds);

    if (currentLinks) {
      const currentMap = new Map<string, string>();
      for (const row of currentLinks) {
        if (row.discord_id) currentMap.set(row.discord_id, row.user_id);
      }
      for (const hist of discordHistory) {
        const currentUserId = currentMap.get(hist.discord_id);
        if (currentUserId && currentUserId !== hist.user_id) {
          if (!discordClusters.has(hist.discord_id)) discordClusters.set(hist.discord_id, new Set());
          discordClusters.get(hist.discord_id)!.add(hist.user_id);
          discordClusters.get(hist.discord_id)!.add(currentUserId);
        }
      }
    }
  }

  // VPN detection
  const userCountries = new Map<string, Set<string>>();
  for (const row of ips) {
    if (!row.country_code) continue;
    if (!userCountries.has(row.user_id)) userCountries.set(row.user_id, new Set());
    userCountries.get(row.user_id)!.add(row.country_code);
  }

  // 3. Merge multi-account clusters using union-find
  const userToGroup = new Map<string, string>();
  const groups = new Map<string, { userIds: Set<string>; reasons: Set<string>; fps: Set<string>; ipAddrs: Set<string> }>();

  function mergeIntoGroup(userIds: string[], reason: string, fpSet?: string[], ipSet?: string[]) {
    let groupId: string | null = null;
    for (const uid of userIds) {
      const existing = userToGroup.get(uid);
      if (existing) { groupId = existing; break; }
    }
    if (!groupId) groupId = userIds[0];

    if (!groups.has(groupId)) {
      groups.set(groupId, { userIds: new Set(), reasons: new Set(), fps: new Set(), ipAddrs: new Set() });
    }
    const group = groups.get(groupId)!;
    group.reasons.add(reason);
    for (const uid of userIds) {
      const oldGroupId = userToGroup.get(uid);
      if (oldGroupId && oldGroupId !== groupId && groups.has(oldGroupId)) {
        const oldGroup = groups.get(oldGroupId)!;
        for (const oldUid of oldGroup.userIds) { group.userIds.add(oldUid); userToGroup.set(oldUid, groupId); }
        for (const r of oldGroup.reasons) group.reasons.add(r);
        for (const f of oldGroup.fps) group.fps.add(f);
        for (const i of oldGroup.ipAddrs) group.ipAddrs.add(i);
        groups.delete(oldGroupId);
      }
      group.userIds.add(uid);
      userToGroup.set(uid, groupId);
    }
    if (fpSet) for (const f of fpSet) group.fps.add(f);
    if (ipSet) for (const i of ipSet) group.ipAddrs.add(i);
  }

  for (const [fp, users] of fpClusters) {
    if (users.size < 2) continue;
    mergeIntoGroup([...users], 'Shared Fingerprint', [fp]);
  }
  for (const [ip, users] of ipClusters) {
    if (users.size < 2) continue;
    mergeIntoGroup([...users], 'Shared IP', undefined, [ip]);
  }
  for (const [discordId, users] of discordClusters) {
    mergeIntoGroup([...users], `Shared Discord (${discordId})`);
  }

  // 4. Build result
  const result: DetectedGroup[] = [];

  // Collect VPN user IDs for tagging multi-account groups
  const vpnUserIds = new Set<string>();
  for (const [userId, countries] of userCountries) {
    if (countries.size >= 2) vpnUserIds.add(userId);
  }

  for (const [, group] of groups) {
    const groupIps = [...group.ipAddrs].map(ip => ({
      ip,
      country: ipMeta.get(ip)?.country || null,
      country_code: ipMeta.get(ip)?.country_code || null,
    }));
    // Check if any user in this group also has VPN usage
    const hasVpn = [...group.userIds].some(uid => vpnUserIds.has(uid));
    const types = hasVpn ? ['multi_account', 'vpn'] : ['multi_account'];
    const reasons = [...group.reasons];
    if (hasVpn) reasons.push('Multiple Countries');

    result.push({
      types,
      reasons: [...new Set(reasons)],
      userIds: [...group.userIds],
      fingerprints: [...group.fps],
      ips: groupIps,
    });
  }

  // VPN-only groups (users NOT already in a multi-account group)
  for (const [userId, countries] of userCountries) {
    if (countries.size < 2) continue;
    if (userToGroup.has(userId)) continue;

    const userIps = ips
      .filter(i => i.user_id === userId)
      .map(i => ({ ip: i.ip_address, country: i.country, country_code: i.country_code }));
    const uniqueIps = [...new Map(userIps.map(i => [i.ip, i])).values()];

    result.push({
      types: ['vpn'],
      reasons: ['Multiple Countries'],
      userIds: [userId],
      fingerprints: [],
      ips: uniqueIps,
    });
  }

  return result;
}

async function upsertAbuseCases(detected: DetectedGroup[]): Promise<{ created: number; updated: number; affectedUserIds: string[] }> {
  let created = 0;
  let updated = 0;
  const affectedUserIds: string[] = [];

  // Fetch all existing abuse cases
  const { data: existingCases, error } = await supabase
    .from('abuse_cases')
    .select('id, type, status, reasons, user_ids, fingerprints, ips');

  if (error) throw new Error(`Failed to fetch existing cases: ${error.message}`);
  const cases = existingCases || [];

  const matchedCaseIds = new Set<string>();

  for (const group of detected) {
    // Find existing case with overlapping user_ids (regardless of types)
    const match = cases.find((c: { id: string; user_ids: string[] }) =>
      !matchedCaseIds.has(c.id) &&
      c.user_ids.some((uid: string) => group.userIds.includes(uid))
    );

    if (match) {
      matchedCaseIds.add(match.id);

      const mergedTypes = [...new Set([...(match.types || []), ...group.types])];
      const mergedUserIds = [...new Set([...match.user_ids, ...group.userIds])];
      const mergedReasons = [...new Set([...(match.reasons || []), ...group.reasons])];
      const mergedFingerprints = [...new Set([...(match.fingerprints || []), ...group.fingerprints])];

      const existingIps: { ip: string; country: string | null; country_code: string | null }[] = match.ips || [];
      const mergedIps = [...new Map([...existingIps, ...group.ips].map((i: { ip: string }) => [i.ip, i])).values()];

      const changed =
        mergedTypes.length !== (match.types || []).length ||
        mergedUserIds.length !== match.user_ids.length ||
        mergedReasons.length !== (match.reasons || []).length ||
        mergedFingerprints.length !== (match.fingerprints || []).length ||
        mergedIps.length !== existingIps.length;

      if (changed) {
        const updateData: Record<string, unknown> = {
          types: mergedTypes,
          user_ids: mergedUserIds,
          reasons: mergedReasons,
          fingerprints: mergedFingerprints,
          ips: mergedIps,
          updated_at: new Date().toISOString(),
        };

        if (match.status === 'closed') {
          updateData.status = 'open';
          updateData.closed_at = null;
        }

        await supabase.from('abuse_cases').update(updateData).eq('id', match.id);
        updated++;
        affectedUserIds.push(...group.userIds);
      }
    } else {
      await supabase.from('abuse_cases').insert({
        types: group.types,
        status: 'open',
        reasons: group.reasons,
        user_ids: group.userIds,
        fingerprints: group.fingerprints,
        ips: group.ips,
      });
      created++;
      affectedUserIds.push(...group.userIds);
    }
  }

  return { created, updated, affectedUserIds };
}

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ABUSE = process.env.DISCORD_CHANNEL_ABUSE || '1490126841493717024';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://admin.chessr.io';

async function sendAbuseScanNotification(
  source: string,
  created: number,
  updated: number,
  affectedUserIds: string[],
): Promise<void> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_CHANNEL_ABUSE) return;
  if (created === 0 && updated === 0) return;

  try {
    // Fetch emails for affected users
    const emails: string[] = [];
    if (affectedUserIds.length > 0) {
      const uniqueIds = [...new Set(affectedUserIds)];
      for (const uid of uniqueIds.slice(0, 20)) {
        const { data } = await supabase.auth.admin.getUserById(uid);
        if (data?.user?.email) emails.push(data.user.email);
      }
    }

    // Build title
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} new`);
    if (updated > 0) parts.push(`${updated} updated`);
    const title = `🚨 Abuse Scan — ${parts.join(', ')}`;

    // Build dashboard link with email filter
    const filterParam = emails.length > 0 ? `&filter=${encodeURIComponent(emails.join(','))}` : '';
    const dashboardLink = `${DASHBOARD_URL}/?tab=abuse${filterParam}`;

    const fields: { name: string; value: string; inline: boolean }[] = [
      { name: '📡 Source', value: source, inline: true },
      { name: '🆕 Created', value: String(created), inline: true },
      { name: '🔄 Updated', value: String(updated), inline: true },
    ];
    fields.push({ name: '🔗 Dashboard', value: `[View abuse cases](${dashboardLink})`, inline: false });

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
    });
  } catch (e) {
    console.error('[Discord] Failed to send abuse scan notification:', e);
  }
}

export async function scanAbuse(): Promise<{ created: number; updated: number; total: number }> {
  const detected = await detectAbuse();
  const { created, updated, affectedUserIds } = await upsertAbuseCases(detected);

  await sendAbuseScanNotification('Cron', created, updated, affectedUserIds);

  return { created, updated, total: detected.length };
}

// Run directly when executed as a cron job
const isDirectExecution = process.argv[1]?.endsWith('scan-abuse.ts');
if (isDirectExecution) {
  console.log(`[Cron] Scanning abuse at ${new Date().toISOString()}`);
  scanAbuse()
    .then(({ created, updated, total }) => {
      console.log(`[Cron] Abuse scan complete: ${total} detected, ${created} created, ${updated} updated`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Cron] Abuse scan failed:', err);
      process.exit(1);
    });
}
