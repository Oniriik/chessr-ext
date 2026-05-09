'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, MessageSquare, Search, Send, Users as UsersIcon } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';
import { planBadgeStyle } from '@/lib/plan-colors';
import { cn } from '@/lib/utils';

type ConnectedUser = {
  userId: string;
  email: string | null;
  plan: string;
  connectedAt: number;
};

type Tab = 'extension' | 'discord';

export default function MessagesPage() {
  const [tab, setTab] = useState<Tab>('extension');

  return (
    <AdminShell title="Messages">
      <div className="space-y-4">
        {/* ─── Tab switch ────────────────────────────────────────── */}
        <div className="inline-flex items-center rounded-md border border-border bg-card/40 p-0.5">
          {([
            { id: 'extension' as const, label: 'Extension' },
            { id: 'discord'   as const, label: 'Discord (soon)' },
          ]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              type="button"
              className={cn(
                'inline-flex h-8 items-center rounded px-3 text-[12px] font-medium transition-colors',
                tab === id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
                id === 'discord' && 'cursor-not-allowed opacity-60',
              )}
              disabled={id === 'discord'}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'extension' && <ExtensionForm />}
        {tab === 'discord' && (
          <Card>
            <CardContent className="p-6 text-[13px] text-muted-foreground sm:p-6">
              Discord broadcast coming soon — same UI, different transport.
            </CardContent>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}

// ─── Extension form ────────────────────────────────────────────────────
function ExtensionForm() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [mode, setMode] = useState<'all' | 'specific'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState<ConnectedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Live-poll the connected users so the admin's selection reflects who
  // is actually online RIGHT NOW. Same 5s cadence as /live keeps the
  // server load identical (one shared upstream).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { data: sess } = await getSupabase().auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/users/connected?token=${encodeURIComponent(token)}`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setConnected((json.users ?? []) as ConnectedUser[]);
      } catch { /* keep last known list */ }
      finally { if (!cancelled) setLoadingUsers(false); }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Drop selections for users who logged off between polls — sending to
  // an offline user is a no-op anyway, but a stale-checked row is
  // confusing.
  useEffect(() => {
    if (connected.length === 0) return;
    setSelected((prev) => {
      const ids = new Set(connected.map((u) => u.userId));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => { if (ids.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [connected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connected;
    return connected.filter((u) =>
      u.email?.toLowerCase().includes(q) || u.userId.toLowerCase().includes(q),
    );
  }, [connected, search]);

  function toggleOne(uid: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid); else n.add(uid);
      return n;
    });
  }
  function selectAllVisible() {
    setSelected((s) => {
      const n = new Set(s);
      filtered.forEach((u) => n.add(u.userId));
      return n;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  async function send() {
    setSending(true);
    setResult(null);
    try {
      const { data: sess } = await getSupabase().auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const message: Record<string, unknown> = {
        // Random id so repeat sends with the same content still queue.
        id: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: 'admin',
        title: title.trim(),
      };
      if (body.trim()) message.body = body.trim();
      if (ctaLabel.trim() && ctaUrl.trim()) {
        message.cta = {
          label: ctaLabel.trim(),
          action: { kind: 'open-url', url: ctaUrl.trim() },
        };
      }

      const recip = mode === 'all' ? 'all' : Array.from(selected);

      const res = await fetch(`/api/admin/messages?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: recip, message }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      setResult({
        ok: true,
        text: `Delivered to ${json.delivered}/${json.recipients} target(s) (${json.online ?? '?'} online).`,
      });
      setTitle('');
      setBody('');
      setCtaLabel('');
      setCtaUrl('');
      setSelected(new Set());
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  }

  const canSend =
    title.trim().length > 0 &&
    !sending &&
    (mode === 'all' || selected.size > 0) &&
    (!ctaLabel.trim() || ctaUrl.trim().length > 0);

  const sendLabel = mode === 'all'
    ? `Send to all (${connected.length})`
    : `Send to ${selected.size}`;

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquare size={12} />
          Send a system message
        </div>

        {/* Title + body */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Quick heads-up"
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Body (optional)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Optional supporting text…"
            rows={3}
            maxLength={500}
            className="w-full resize-y rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* CTA */}
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              CTA label (optional)
            </label>
            <Input
              value={ctaLabel}
              onChange={(e) => setCtaLabel(e.target.value)}
              placeholder="Read more"
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              CTA URL
            </label>
            <Input
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </div>
        </div>

        {/* Recipients */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <UsersIcon size={11} />
              Recipients
            </label>
            <span className="num text-[10px] text-muted-foreground/70">
              {connected.length} online
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {(['all', 'specific'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                  mode === m
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {m === 'all' ? 'All connected' : 'Specific users'}
              </button>
            ))}
            {mode === 'specific' && (
              <span className="num ml-2 text-[11px] text-muted-foreground">
                {selected.size} selected
              </span>
            )}
          </div>

          {mode === 'specific' && (
            <>
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="relative flex-1">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by email or user_id…"
                    className="pl-8"
                  />
                </div>
                <button
                  type="button"
                  onClick={selectAllVisible}
                  disabled={filtered.length === 0}
                  className="shrink-0 text-[11px] text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Select visible
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={selected.size === 0}
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  Clear
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background/40">
                {loadingUsers ? (
                  <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" />
                    Loading connected users…
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-3 py-3 text-[12px] text-muted-foreground">
                    {connected.length === 0 ? 'Nobody is online right now.' : `No match for "${search}".`}
                  </div>
                ) : (
                  <ul>
                    {filtered.map((u, i) => {
                      const isSelected = selected.has(u.userId);
                      return (
                        <li
                          key={u.userId}
                          onClick={() => toggleOne(u.userId)}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors',
                            i > 0 && 'border-t border-border/40',
                            isSelected ? 'bg-primary/10' : 'hover:bg-muted/40',
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                              isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background',
                            )}
                          >
                            {isSelected && <Check size={11} strokeWidth={3} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium">{u.email || '—'}</div>
                            <div className="truncate font-mono text-[10px] text-muted-foreground">{u.userId}</div>
                          </div>
                          <span
                            className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                            style={planBadgeStyle(u.plan)}
                          >
                            {u.plan}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex-1 text-[11px]">
            {result && (
              <span className={cn(
                'inline-flex items-center gap-1.5',
                result.ok ? 'text-emerald-400' : 'text-destructive',
              )}>
                {result.ok ? <Check size={12} /> : <AlertCircle size={12} />}
                {result.text}
              </span>
            )}
          </div>
          <Button onClick={send} disabled={!canSend}>
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {sendLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
