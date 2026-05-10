'use client';

import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authQS } from './giveaway-shared';

/** Inline grant-tickets panel. Toggled by a "+ Grant tickets" button.
 *  Avoids pulling in a full Dialog primitive — the form is small,
 *  fits next to the page header. */
export function GrantTicketPanel({
  giveawayId, disabled, onGranted,
}: {
  giveawayId: number;
  disabled?: boolean;
  onGranted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [discordId, setDiscordId] = useState('');
  const [count, setCount] = useState<number>(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDiscordId(''); setCount(1); setReason(''); setError(null); setBusy(false);
  }

  async function submit() {
    setError(null);
    const id = discordId.trim();
    if (!/^\d{17,20}$/.test(id)) { setError('Discord ID must be a 17-20 digit Snowflake'); return; }
    if (!Number.isFinite(count) || count < 1 || count > 1000) {
      setError('Count must be 1..1000'); return;
    }
    setBusy(true);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${giveawayId}/grant?token=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: id, count, reason: reason.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      reset();
      setOpen(false);
      onGranted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Grant failed');
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)} disabled={disabled} className="gap-2">
        <Plus size={13} /> Grant tickets
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-emerald-400">Grant tickets</span>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_2fr]">
        <Input
          placeholder="Discord ID (17-20 digits)"
          value={discordId}
          onChange={(e) => setDiscordId(e.target.value)}
          disabled={busy}
          className="h-8 text-[12px]"
        />
        <Input
          type="number" min={1} max={1000}
          placeholder="Count"
          value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
          disabled={busy}
          className="h-8 w-20 text-[12px]"
        />
        <Input
          placeholder="Reason (optional, audit-only)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          className="h-8 text-[12px]"
        />
      </div>

      {error && (
        <div className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>One row, one event, one DM — no matter the count.</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); reset(); }} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : `Grant ${count}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
