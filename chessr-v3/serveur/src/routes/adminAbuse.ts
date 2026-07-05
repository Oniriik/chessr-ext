/**
 * Admin abuse-scan endpoints — backs the dashboard's /abuse page.
 *
 *   POST /admin/abuse/scan   → run a full scan now, persist the snapshot
 *                              in the local analytics DB, return it.
 *   GET  /admin/abuse/latest → return the most recent snapshot (or null).
 *
 * The scan clusters accounts two ways:
 *   - fingerprint clusters (union-find over shared device fingerprints —
 *     the deterministic multi-account signal)
 *   - IP groups (accounts sharing a signup/login IP — weaker signal,
 *     carrier-grade NAT can collide strangers, so groups are kept
 *     separate from fingerprint clusters instead of merged)
 *
 * Each group carries: per-account email / created_at (Supabase admin
 * API), current + past Discord links (events log), plan, trial usage,
 * ban state, IP stack (with countries) and fingerprint stack (shared
 * ones flagged); group-level flags (freetrial abuse, VPN = multi-country
 * IPs, has-banned) plus the group's FIRST signup and FIRST Discord link;
 * and an isNew marker diffed against the previous scan's group keys.
 *
 * Auth: same X-Admin-Token gate as the other /admin/* routes.
 */

import { Hono, type Context } from 'hono';
import { createHash } from 'node:crypto';
import { supabase } from '../lib/supabase.js';
import { dbQuery } from '../lib/db.js';

export const adminAbuseRoutes = new Hono();

function hasValidAdminToken(c: Context): boolean {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  return !!expected && token === expected;
}

// ─── Scan data shapes (persisted verbatim in abuse_scans.result) ────────

interface AbuseAccount {
  userId: string;
  email: string | null;
  createdAt: string | null;
  plan: string;
  freetrialUsed: boolean;
  banned: boolean;
  banReason: string | null;
  discordCurrent: string | null;
  discordPast: string[];
  discordLinkedAt: string | null;
  ips: { ip: string; countryCode: string | null }[];
  fingerprints: string[];
  vpn: boolean;
}

interface AbuseGroup {
  key: string;
  kind: 'fingerprint' | 'ip';
  /** The shared IP for kind='ip' groups. */
  ip: string | null;
  accounts: AbuseAccount[];
  sharedFingerprints: string[];
  sharedIps: string[];
  trialsUsed: number;
  countries: string[];
  vpn: boolean;
  hasBanned: boolean;
  firstSignup: { email: string | null; userId: string; at: string | null } | null;
  firstDiscordLink: { username: string | null; userId: string; at: string } | null;
  isNew: boolean;
}

// ─── Supabase paginated fetch ────────────────────────────────────────────

async function fetchAllRows<T>(table: string, select: string): Promise<T[]> {
  const rows: T[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ─── Union-find ──────────────────────────────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const groupKey = (kind: string, memberIds: string[]): string =>
  kind + ':' + createHash('sha1').update([...memberIds].sort().join(',')).digest('hex').slice(0, 12);

// ─── The scan ────────────────────────────────────────────────────────────

export async function runAbuseScan(): Promise<{ stats: Record<string, unknown>; result: { fingerprintClusters: AbuseGroup[]; ipGroups: AbuseGroup[] } }> {
  const [fpRows, ipRows, settings] = await Promise.all([
    fetchAllRows<{ user_id: string; fingerprint: string }>('user_fingerprints', 'user_id,fingerprint'),
    fetchAllRows<{ user_id: string; ip_address: string; country_code: string | null }>('signup_ips', 'user_id,ip_address,country_code'),
    fetchAllRows<{ user_id: string; plan: string | null; freetrial_used: boolean | null; banned: boolean | null; ban_reason: string | null; discord_username: string | null; discord_linked_at: string | null }>(
      'user_settings', 'user_id,plan,freetrial_used,banned,ban_reason,discord_username,discord_linked_at',
    ),
  ]);
  const settingsById = new Map(settings.map((s) => [s.user_id, s]));

  const fpsByUser = new Map<string, string[]>();
  const usersByFp = new Map<string, Set<string>>();
  for (const r of fpRows) {
    (fpsByUser.get(r.user_id) ?? fpsByUser.set(r.user_id, []).get(r.user_id)!).push(r.fingerprint);
    (usersByFp.get(r.fingerprint) ?? usersByFp.set(r.fingerprint, new Set()).get(r.fingerprint)!).add(r.user_id);
  }
  const ipsByUser = new Map<string, { ip: string; countryCode: string | null }[]>();
  const usersByIp = new Map<string, Set<string>>();
  for (const r of ipRows) {
    (ipsByUser.get(r.user_id) ?? ipsByUser.set(r.user_id, []).get(r.user_id)!).push({ ip: r.ip_address, countryCode: r.country_code });
    (usersByIp.get(r.ip_address) ?? usersByIp.set(r.ip_address, new Set()).get(r.ip_address)!).add(r.user_id);
  }

  // Fingerprint clusters (2+ accounts)
  const uf = new UnionFind();
  for (const users of usersByFp.values()) {
    const list = [...users];
    for (let i = 1; i < list.length; i++) uf.union(list[0], list[i]);
  }
  const clusterMembers = new Map<string, Set<string>>();
  for (const r of fpRows) {
    const root = uf.find(r.user_id);
    (clusterMembers.get(root) ?? clusterMembers.set(root, new Set()).get(root)!).add(r.user_id);
  }
  const fpClusters = [...clusterMembers.values()].filter((c) => c.size > 1);

  // IP groups (2+ accounts on one IP)
  const ipGroupsRaw = [...usersByIp.entries()].filter(([, users]) => users.size > 1);

  // Enrich only the users that appear in some group.
  const involved = new Set<string>();
  for (const c of fpClusters) for (const u of c) involved.add(u);
  for (const [, users] of ipGroupsRaw) for (const u of users) involved.add(u);

  // Emails + created_at via the Supabase admin API, small concurrency.
  const authInfo = new Map<string, { email: string | null; createdAt: string | null }>();
  const ids = [...involved];
  const CONCURRENCY = 8;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    await Promise.all(ids.slice(i, i + CONCURRENCY).map(async (id) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(id);
        authInfo.set(id, { email: data?.user?.email ?? null, createdAt: data?.user?.created_at ?? null });
      } catch {
        authInfo.set(id, { email: null, createdAt: null });
      }
    }));
  }

  // Discord link history from the events log — lets us show "was linked"
  // for accounts that unlinked, and the group's first link.
  interface DiscordEvent { user_id: string; type: string; username: string | null; created_at: string }
  let discordEvents: DiscordEvent[] = [];
  try {
    discordEvents = await dbQuery<DiscordEvent>(
      `SELECT user_id::text, type, payload->>'discordUsername' AS username, created_at::text
         FROM events
        WHERE type IN ('discord_linked', 'discord_unlinked')
          AND user_id = ANY($1::uuid[])
        ORDER BY created_at ASC`,
      [ids],
    );
  } catch (err) {
    console.warn('[admin.abuse] discord history query failed:', err);
  }
  const discordHistory = new Map<string, DiscordEvent[]>();
  for (const e of discordEvents) {
    (discordHistory.get(e.user_id) ?? discordHistory.set(e.user_id, []).get(e.user_id)!).push(e);
  }

  const buildAccount = (userId: string): AbuseAccount => {
    const s = settingsById.get(userId);
    const auth = authInfo.get(userId);
    const ips = ipsByUser.get(userId) ?? [];
    const history = discordHistory.get(userId) ?? [];
    const current = s?.discord_username ?? null;
    const past = [...new Set(
      history
        .filter((e) => e.type === 'discord_linked' && e.username && e.username !== current)
        .map((e) => e.username as string),
    )];
    const ownCountries = new Set(ips.map((i) => i.countryCode).filter(Boolean));
    return {
      userId,
      email: auth?.email ?? null,
      createdAt: auth?.createdAt ?? null,
      plan: s?.plan ?? 'free',
      freetrialUsed: !!s?.freetrial_used,
      banned: !!s?.banned,
      banReason: s?.ban_reason ?? null,
      discordCurrent: current,
      discordPast: past,
      discordLinkedAt: s?.discord_linked_at ?? null,
      ips,
      fingerprints: [...new Set(fpsByUser.get(userId) ?? [])],
      vpn: ownCountries.size >= 2,
    };
  };

  const buildGroup = (kind: 'fingerprint' | 'ip', memberIds: string[], ip: string | null): AbuseGroup => {
    const accounts = memberIds.map(buildAccount)
      .sort((a, b) => (a.createdAt ?? '9999').localeCompare(b.createdAt ?? '9999'));
    const memberSet = new Set(memberIds);

    const fpCounts = new Map<string, number>();
    for (const a of accounts) for (const f of a.fingerprints) fpCounts.set(f, (fpCounts.get(f) ?? 0) + 1);
    const sharedFingerprints = [...fpCounts.entries()].filter(([, n]) => n > 1).map(([f]) => f);
    const ipUserCounts = new Map<string, Set<string>>();
    for (const a of accounts) for (const i of a.ips) {
      (ipUserCounts.get(i.ip) ?? ipUserCounts.set(i.ip, new Set()).get(i.ip)!).add(a.userId);
    }
    const sharedIps = [...ipUserCounts.entries()].filter(([, u]) => u.size > 1).map(([i]) => i);

    const countries = [...new Set(accounts.flatMap((a) => a.ips.map((i) => i.countryCode)).filter(Boolean))] as string[];

    // First Discord link across the group — prefer the events log (exact
    // timestamps incl. re-links), fall back to discord_linked_at.
    let firstLink: AbuseGroup['firstDiscordLink'] = null;
    for (const e of discordEvents) {
      if (e.type !== 'discord_linked' || !memberSet.has(e.user_id)) continue;
      if (!firstLink || e.created_at < firstLink.at) {
        firstLink = { username: e.username, userId: e.user_id, at: e.created_at };
      }
    }
    if (!firstLink) {
      for (const a of accounts) {
        if (!a.discordLinkedAt) continue;
        if (!firstLink || a.discordLinkedAt < firstLink.at) {
          firstLink = { username: a.discordCurrent, userId: a.userId, at: a.discordLinkedAt };
        }
      }
    }

    const first = accounts.find((a) => a.createdAt) ?? accounts[0];
    return {
      key: groupKey(kind, memberIds),
      kind,
      ip,
      accounts,
      sharedFingerprints,
      sharedIps,
      trialsUsed: accounts.filter((a) => a.freetrialUsed).length,
      countries,
      vpn: accounts.some((a) => a.vpn),
      hasBanned: accounts.some((a) => a.banned),
      firstSignup: first ? { email: first.email, userId: first.userId, at: first.createdAt } : null,
      firstDiscordLink: firstLink,
      isNew: false, // filled after diffing with the previous scan
    };
  };

  const fingerprintClusters = fpClusters.map((c) => buildGroup('fingerprint', [...c], null));
  const ipGroups = ipGroupsRaw.map(([ip, users]) => buildGroup('ip', [...users], ip));

  // Severity sort: trials consumed desc, then size desc.
  const bySeverity = (a: AbuseGroup, b: AbuseGroup) =>
    b.trialsUsed - a.trialsUsed || b.accounts.length - a.accounts.length;
  fingerprintClusters.sort(bySeverity);
  ipGroups.sort(bySeverity);

  // Diff vs the previous scan for NEW badges.
  try {
    const prev = await dbQuery<{ result: { fingerprintClusters?: { key: string }[]; ipGroups?: { key: string }[] } }>(
      'SELECT result FROM abuse_scans ORDER BY id DESC LIMIT 1', [],
    );
    if (prev.length > 0) {
      const prevKeys = new Set([
        ...(prev[0].result.fingerprintClusters ?? []).map((g) => g.key),
        ...(prev[0].result.ipGroups ?? []).map((g) => g.key),
      ]);
      for (const g of [...fingerprintClusters, ...ipGroups]) g.isNew = !prevKeys.has(g.key);
    }
  } catch (err) {
    console.warn('[admin.abuse] previous-scan diff failed:', err);
  }

  const stats = {
    usersScanned: settings.length,
    fingerprintRows: fpRows.length,
    ipRows: ipRows.length,
    fingerprintClusters: fingerprintClusters.length,
    ipGroups: ipGroups.length,
    trialFarmClusters: fingerprintClusters.filter((g) => g.trialsUsed >= 2).length,
    newGroups: [...fingerprintClusters, ...ipGroups].filter((g) => g.isNew).length,
  };

  return { stats, result: { fingerprintClusters, ipGroups } };
}

// ─── Routes ──────────────────────────────────────────────────────────────

adminAbuseRoutes.post('/admin/abuse/scan', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  try {
    const { stats, result } = await runAbuseScan();
    const rows = await dbQuery<{ id: string; created_at: string }>(
      'INSERT INTO abuse_scans (stats, result) VALUES ($1, $2) RETURNING id, created_at::text',
      [JSON.stringify(stats), JSON.stringify(result)],
    );
    return c.json({ id: rows[0]?.id ?? null, createdAt: rows[0]?.created_at ?? null, stats, result });
  } catch (err) {
    console.error('[admin.abuse] scan failed:', err);
    return c.json({ error: err instanceof Error ? err.message : 'Scan failed' }, 500);
  }
});

adminAbuseRoutes.get('/admin/abuse/latest', async (c) => {
  if (!hasValidAdminToken(c)) return c.json({ error: 'Forbidden' }, 403);
  try {
    const rows = await dbQuery<{ id: string; created_at: string; stats: unknown; result: unknown }>(
      'SELECT id, created_at::text, stats, result FROM abuse_scans ORDER BY id DESC LIMIT 1', [],
    );
    if (rows.length === 0) return c.json({ scan: null });
    const r = rows[0];
    return c.json({ scan: { id: r.id, createdAt: r.created_at, stats: r.stats, result: r.result } });
  } catch (err) {
    console.error('[admin.abuse] latest failed:', err);
    return c.json({ error: 'Failed to load latest scan' }, 500);
  }
});
