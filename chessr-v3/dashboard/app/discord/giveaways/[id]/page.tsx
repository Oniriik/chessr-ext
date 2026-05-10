'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  AlertCircle, ArrowLeft, Check, Copy, Loader2, RefreshCw, Save, Trash2, Users, Ticket,
} from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/roles';
import {
  authQS, discordTimestamp, type GiveawayDetail, type Prize,
  PrizeChip, StatusBadge,
} from '@/components/discord/giveaway-shared';
import { PrizeEditor } from '@/components/discord/PrizeEditor';
import { GrantTicketPanel } from '@/components/discord/GrantTicketDialog';

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export default function GiveawayDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);

  const [detail, setDetail] = useState<GiveawayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<UserRole>('user');

  // Edit-mode local state for header.
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEndsAt, setEditEndsAt] = useState('');
  const [savingHeader, setSavingHeader] = useState(false);

  // Prize editor local state. Persisted via PUT on Save.
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [savingPrizes, setSavingPrizes] = useState(false);
  const [tsCopied, setTsCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${id}?token=${t}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail(json);
      setPrizes(json.prizes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  // Caller role lookup — same pattern used elsewhere on the dashboard.
  useEffect(() => {
    (async () => {
      const sb = getSupabase();
      const { data: sess } = await sb.auth.getSession();
      if (!sess.session) return;
      const res = await fetch('/api/auth/check-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: sess.session.user.id }),
      }).catch(() => null);
      if (!res) return;
      const json = await res.json();
      if (json.role) setCallerRole(json.role as UserRole);
    })();
  }, []);

  const isSuper = callerRole === 'super_admin';
  const isLocked = !!detail && detail.giveaway.status !== 'scheduled';
  const tsTag = useMemo(
    () => detail ? discordTimestamp(detail.giveaway.ends_at, 'F') : '',
    [detail],
  );

  function startEdit() {
    if (!detail) return;
    setEditName(detail.giveaway.name);
    setEditEndsAt(toDatetimeLocal(detail.giveaway.ends_at));
    setEditing(true);
  }

  async function saveHeader() {
    if (!detail) return;
    setSavingHeader(true);
    setError(null);
    try {
      const t = await authQS();
      const ends = new Date(editEndsAt);
      if (Number.isNaN(ends.getTime())) throw new Error('Invalid date');
      const res = await fetch(`/api/admin/giveaways/${id}?token=${t}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), endsAt: ends.toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingHeader(false);
    }
  }

  async function savePrizes() {
    setSavingPrizes(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${id}/prizes?token=${t}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPrizes(false);
    }
  }

  async function cancelGiveaway() {
    if (!confirm('Cancel this giveaway? No new tickets can be granted afterwards.')) return;
    setCancelling(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${id}/cancel?token=${t}`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  async function copyTs() {
    if (!tsTag) return;
    await navigator.clipboard.writeText(tsTag);
    setTsCopied(true);
    setTimeout(() => setTsCopied(false), 1500);
  }

  // Detect whether the local prizes diverge from the saved ones so we
  // can enable/disable Save accordingly. JSON comparison is fine at
  // this scale — we cap the prize count well below any heavy threshold.
  const prizesDirty = useMemo(() => {
    if (!detail) return false;
    return JSON.stringify(prizes) !== JSON.stringify(detail.prizes);
  }, [prizes, detail]);

  return (
    <AdminShell
      title={detail?.giveaway.name ?? 'Giveaway'}
      actions={
        <Link href="/discord/giveaways"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft size={13} /> Back
        </Link>
      }
    >
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading || !detail ? (
        <Card><CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {/* ─── Header card ──────────────────────────────────────────── */}
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-5">
              {!editing ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold">{detail.giveaway.name}</h2>
                        <StatusBadge status={detail.giveaway.status} />
                      </div>
                      <div className="num text-[11px] text-muted-foreground">
                        Ends {format(new Date(detail.giveaway.ends_at), 'PPp')} · ID #{detail.giveaway.id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="ghost" onClick={load} className="h-8 gap-1">
                        <RefreshCw size={12} /> Refresh
                      </Button>
                      {!isLocked && (
                        <>
                          <Button size="sm" variant="outline" onClick={startEdit} disabled={!isSuper}
                            title={!isSuper ? 'super_admin required' : undefined}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelGiveaway} disabled={!isSuper || cancelling}
                            className="text-destructive hover:text-destructive"
                            title={!isSuper ? 'super_admin required' : undefined}>
                            {cancelling ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-background/40 p-2.5 text-[11px]">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Discord timestamp
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">{tsTag}</code>
                      <Button size="sm" variant="outline" onClick={copyTs} className="h-7 gap-1 px-2 text-[11px]">
                        {tsCopied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4 text-[12px]">
                    <span className="num inline-flex items-center gap-1.5 tabular-nums">
                      <Ticket size={13} className="text-muted-foreground" /> {detail.stats.tickets} tickets
                    </span>
                    <span className="num inline-flex items-center gap-1.5 tabular-nums">
                      <Users size={13} className="text-muted-foreground" /> {detail.stats.participants} participants
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</label>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} disabled={savingHeader} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ends at</label>
                    <Input
                      type="datetime-local"
                      value={editEndsAt}
                      onChange={(e) => setEditEndsAt(e.target.value)}
                      disabled={savingHeader}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={savingHeader}>Cancel</Button>
                    <Button size="sm" onClick={saveHeader} disabled={savingHeader} className="gap-1.5">
                      {savingHeader ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                      Save
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ─── Grant tickets ────────────────────────────────────────── */}
          {!isLocked && (
            <Card>
              <CardContent className="p-4 sm:p-5">
                <GrantTicketPanel
                  giveawayId={id}
                  disabled={!isSuper}
                  onGranted={load}
                />
                {!isSuper && (
                  <div className="mt-2 text-[10px] text-muted-foreground">super_admin required to grant.</div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ─── Prizes ───────────────────────────────────────────────── */}
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold">Prizes</h3>
                {prizesDirty && !isLocked && (
                  <Button size="sm" onClick={savePrizes} disabled={savingPrizes || !isSuper} className="gap-1.5">
                    {savingPrizes ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save changes
                  </Button>
                )}
              </div>
              {isLocked ? (
                // Read-only summary on cancelled/completed giveaways.
                <ul className="space-y-1.5">
                  {prizes.map((p) => (
                    <li key={p.position} className="flex items-center gap-2 text-[12px]">
                      <span className="num w-6 text-right tabular-nums text-muted-foreground">#{p.position}</span>
                      <PrizeChip p={p} />
                    </li>
                  ))}
                </ul>
              ) : (
                <PrizeEditor prizes={prizes} setPrizes={setPrizes} disabled={savingPrizes || !isSuper} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
