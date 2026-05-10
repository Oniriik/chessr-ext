'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Check, Copy, Loader2 } from 'lucide-react';
import { AdminShell } from '@/components/AdminShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authQS, discordTimestamp, type Prize } from '@/components/discord/giveaway-shared';
import { PrizeEditor } from '@/components/discord/PrizeEditor';

/** Format a Date as a value the <input type="datetime-local"> control
 *  understands. UTC offset is local — the user's browser timezone. */
function toDatetimeLocal(d: Date): string {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export default function NewGiveawayPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  // Default the picker to "tomorrow at 18:00 local" — typical reveal slot.
  const [endsAtLocal, setEndsAtLocal] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
    return toDatetimeLocal(d);
  });
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tsCopied, setTsCopied] = useState(false);

  const endsAtIso = useMemo(() => {
    if (!endsAtLocal) return null;
    const d = new Date(endsAtLocal);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }, [endsAtLocal]);

  const tsTag = endsAtIso ? discordTimestamp(endsAtIso, 'F') : '';
  const tsRel = endsAtIso ? discordTimestamp(endsAtIso, 'R') : '';

  async function copyTs() {
    if (!tsTag) return;
    await navigator.clipboard.writeText(tsTag);
    setTsCopied(true);
    setTimeout(() => setTsCopied(false), 1500);
  }

  async function submit() {
    setError(null);
    if (!name.trim())     { setError('Name required'); return; }
    if (!endsAtIso)       { setError('End date required'); return; }
    if (prizes.length === 0) { setError('Add at least one prize'); return; }

    setSubmitting(true);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways?token=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), endsAt: endsAtIso, prizes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      router.replace(`/discord/giveaways/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setSubmitting(false);
    }
  }

  return (
    <AdminShell
      title="New giveaway"
      actions={
        <Link href="/discord/giveaways"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft size={13} /> Back
        </Link>
      }
    >
      <div className="mx-auto max-w-2xl space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={13} /> {error}
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Boost giveaway #2"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ends at (local time)
              </label>
              <Input
                type="datetime-local"
                value={endsAtLocal}
                onChange={(e) => setEndsAtLocal(e.target.value)}
                disabled={submitting}
              />
              {endsAtIso && (
                <div className="rounded-md border border-border bg-background/40 p-2.5 text-[11px]">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Discord timestamp (copy into your announcement)
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">{tsTag}</code>
                    <Button size="sm" variant="outline" onClick={copyTs} className="h-7 gap-1 px-2 text-[11px]">
                      {tsCopied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
                    </Button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground">
                    Renders as: <strong>local time of the viewer</strong> · also <code>{tsRel}</code> for relative.
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Prizes (top of list = grand prize)
              </label>
              <PrizeEditor prizes={prizes} setPrizes={setPrizes} disabled={submitting} />
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-4">
              <Link href="/discord/giveaways"
                className="inline-flex h-9 items-center rounded-md border border-border px-4 text-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Cancel
              </Link>
              <Button onClick={submit} disabled={submitting}>
                {submitting ? <Loader2 size={13} className="animate-spin" /> : 'Create giveaway'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
