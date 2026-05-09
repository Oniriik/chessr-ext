'use client';

import { useState } from 'react';
import { AlertCircle, Check, Loader2, MessageSquare, Send } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

const CATEGORIES = ['admin', 'info', 'trial', 'discord', 'howto'] as const;
type Category = typeof CATEGORIES[number];

const ACCENT: Record<Category, string> = {
  admin:   '#a855f7',
  info:    '#60a5fa',
  trial:   '#f59e0b',
  discord: '#5865F2',
  howto:   '#10b981',
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
  const [category, setCategory] = useState<Category>('admin');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [recipients, setRecipients] = useState<'all' | string>('all');
  const [userIds, setUserIds] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

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
        category,
        title: title.trim(),
      };
      if (body.trim()) message.body = body.trim();
      if (ctaLabel.trim() && ctaUrl.trim()) {
        message.cta = {
          label: ctaLabel.trim(),
          action: { kind: 'open-url', url: ctaUrl.trim() },
        };
      }

      const recip = recipients === 'all'
        ? 'all'
        : userIds.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

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
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setSending(false);
    }
  }

  const canSend =
    title.trim().length > 0 &&
    !sending &&
    (recipients === 'all' || userIds.trim().length > 0) &&
    (!ctaLabel.trim() || ctaUrl.trim().length > 0);

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <MessageSquare size={12} />
          Send a system message
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Category
          </label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                  category === c
                    ? 'border-current'
                    : 'border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                style={category === c ? { color: ACCENT[c], background: `${ACCENT[c]}1f` } : undefined}
              >
                {c}
              </button>
            ))}
          </div>
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
        <div className="space-y-1.5">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Recipients
          </label>
          <div className="flex items-center gap-1.5">
            {(['all', 'specific'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRecipients(r === 'all' ? 'all' : 'specific')}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium capitalize transition-colors',
                  (r === 'all' && recipients === 'all') || (r === 'specific' && recipients !== 'all')
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-border bg-background/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {r === 'all' ? 'All connected' : 'Specific user IDs'}
              </button>
            ))}
          </div>
          {recipients !== 'all' && (
            <textarea
              value={userIds}
              onChange={(e) => setUserIds(e.target.value)}
              placeholder="Paste user_id values, one per line or comma-separated"
              rows={3}
              className="w-full resize-y rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-[11px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
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
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
