'use client';

/**
 * /abuse — manual multi-account & free-trial abuse review.
 *
 * Loads the latest persisted scan on open (snapshots live in the
 * analytics DB, written by the serveur); "Run check" triggers a fresh
 * scan. Two groupings: fingerprint clusters (deterministic same-device
 * signal) and shared-IP groups (weaker, CGNAT-prone — kept separate).
 * Clicking an account opens the standard UserDetailSheet, which carries
 * the password-guarded Ban / Unban actions.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Fingerprint, Globe2, RefreshCw, ShieldAlert } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserDetailSheet } from '@/components/users/UserDetailSheet';
import type { UserRole } from '@/lib/roles';
import { cn } from '@/lib/utils';

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
  ips: { ip: string; countryCode: string | null }[];
  fingerprints: string[];
  vpn: boolean;
}

interface AbuseGroup {
  key: string;
  kind: 'fingerprint' | 'ip';
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

interface Scan {
  id: string;
  createdAt: string;
  stats: Record<string, number>;
  result: { fingerprintClusters: AbuseGroup[]; ipGroups: AbuseGroup[] };
}

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const isAbusive = (g: AbuseGroup) => g.trialsUsed >= 2 || g.vpn || g.hasBanned;

export default function AbusePage() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'fingerprint' | 'ip'>('fingerprint');
  const [abuseOnly, setAbuseOnly] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sheetUser, setSheetUser] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<UserRole>('admin');

  const authedFetch = useCallback(async (method: 'GET' | 'POST') => {
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(`/api/admin/abuse?token=${encodeURIComponent(token)}`, { method });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const res = await fetch('/api/auth/check-role', { headers: { Authorization: `Bearer ${token}` } });
          const json = await res.json().catch(() => ({}));
          if (json?.role) setCallerRole(json.role as UserRole);
        }
      } catch { /* keep default */ }
    })();
  }, []);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await authedFetch('GET');
      setScan(json.scan ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const json = await authedFetch('POST');
      setScan({ id: json.id, createdAt: json.createdAt, stats: json.stats, result: json.result });
      setExpanded(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const groups = scan
    ? (tab === 'fingerprint' ? scan.result.fingerprintClusters : scan.result.ipGroups).filter((g) => !abuseOnly || isAbusive(g))
    : [];

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <AdminShell>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <ShieldAlert className="h-5 w-5 text-amber-400" /> Abuse
            </h1>
            <p className="text-sm text-muted-foreground">
              {scan ? <>Last scan: {fmtDate(scan.createdAt)}</> : 'No scan yet — run the first check.'}
            </p>
          </div>
          <Button onClick={runScan} disabled={scanning}>
            <RefreshCw className={cn('mr-2 h-4 w-4', scanning && 'animate-spin')} />
            {scanning ? 'Scanning…' : 'Run check'}
          </Button>
        </div>

        {scan && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{scan.stats.usersScanned} users</Badge>
            <Badge variant="outline">{scan.stats.fingerprintClusters} fp clusters</Badge>
            <Badge variant="outline">{scan.stats.ipGroups} IP groups</Badge>
            <Badge variant="outline" className="border-amber-500/50 text-amber-400">
              {scan.stats.trialFarmClusters} trial-farm clusters
            </Badge>
            {(scan.stats.newGroups ?? 0) > 0 && (
              <Badge className="bg-emerald-600">{scan.stats.newGroups} new since last scan</Badge>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant={tab === 'fingerprint' ? 'default' : 'outline'} size="sm" onClick={() => setTab('fingerprint')}>
            <Fingerprint className="mr-1.5 h-4 w-4" /> Fingerprint clusters
          </Button>
          <Button variant={tab === 'ip' ? 'default' : 'outline'} size="sm" onClick={() => setTab('ip')}>
            <Globe2 className="mr-1.5 h-4 w-4" /> IP groups
          </Button>
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={abuseOnly} onChange={(e) => setAbuseOnly(e.target.checked)} />
            Abuse only (2+ trials / VPN / banned)
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups to show.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {groups.map((g) => (
              <div key={g.key} className="rounded-lg border border-border bg-card">
                <button className="flex w-full flex-wrap items-center gap-2 p-3 text-left" onClick={() => toggleExpand(g.key)}>
                  {g.isNew && <Badge className="bg-emerald-600">NEW</Badge>}
                  <Badge variant="outline">{g.accounts.length} accounts</Badge>
                  {g.trialsUsed >= 2 && (
                    <Badge className="bg-amber-600">🎟️ {g.trialsUsed} trials</Badge>
                  )}
                  {g.vpn && <Badge className="bg-purple-600">🌍 VPN {g.countries.join('+')}</Badge>}
                  {g.hasBanned && <Badge className="bg-red-600">⛔ banned</Badge>}
                  {g.kind === 'ip' && <span className="font-mono text-xs text-muted-foreground">{g.ip}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    first signup: <span className="text-foreground">{g.firstSignup?.email ?? '—'}</span> ({fmtDate(g.firstSignup?.at)})
                    {g.firstDiscordLink && (
                      <> · first discord: <span className="text-foreground">{g.firstDiscordLink.username ?? '?'}</span> ({fmtDate(g.firstDiscordLink.at)})</>
                    )}
                  </span>
                </button>

                {expanded.has(g.key) && (
                  <div className="flex flex-col gap-2 border-t border-border p-3">
                    {g.accounts.map((a) => (
                      <div key={a.userId} className="rounded-md bg-muted/40 p-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="font-medium text-blue-400 hover:underline"
                            onClick={() => setSheetUser(a.userId)}
                            title="Open user detail (ban / unban inside)"
                          >
                            {a.email ?? a.userId}
                          </button>
                          <Badge variant="outline">{a.plan}</Badge>
                          {a.freetrialUsed && <Badge variant="outline" className="border-amber-500/50 text-amber-400">trial used</Badge>}
                          {a.vpn && <Badge variant="outline" className="border-purple-500/50 text-purple-400">VPN</Badge>}
                          {a.banned && (
                            <Badge className="bg-red-600" title={a.banReason ?? undefined}>banned{a.banReason ? `: ${a.banReason.slice(0, 40)}` : ''}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">created {fmtDate(a.createdAt)}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            discord: {a.discordCurrent ?? (a.discordPast.length ? `was ${a.discordPast.join(', ')}` : '—')}
                            {a.discordCurrent && a.discordPast.length > 0 && ` (was ${a.discordPast.join(', ')})`}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {a.ips.map((i) => (
                            <span
                              key={i.ip}
                              className={cn(
                                'rounded bg-background px-1.5 py-0.5 font-mono text-[11px]',
                                g.sharedIps.includes(i.ip) ? 'text-amber-400 ring-1 ring-amber-500/50' : 'text-muted-foreground',
                              )}
                            >
                              {i.ip}{i.countryCode ? ` · ${i.countryCode}` : ''}
                            </span>
                          ))}
                          {a.fingerprints.map((f) => (
                            <span
                              key={f}
                              className={cn(
                                'rounded bg-background px-1.5 py-0.5 font-mono text-[11px]',
                                g.sharedFingerprints.includes(f) ? 'text-red-400 ring-1 ring-red-500/50' : 'text-muted-foreground',
                              )}
                              title={f}
                            >
                              fp:{f.slice(0, 10)}…
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <UserDetailSheet
        userId={sheetUser}
        open={sheetUser !== null}
        onClose={() => setSheetUser(null)}
        callerRole={callerRole}
        onUpdated={loadLatest}
      />
    </AdminShell>
  );
}
