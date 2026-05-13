'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, ShieldOff, Trash2, UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authQS } from './giveaway-shared';
import { useResolvedDiscordUsers } from './useResolvedDiscordUsers';

interface ExcludedUser {
  discord_id: string;
  reason: string | null;
  excluded_by_user_id: string | null;
  excluded_at: string;
}

interface Props {
  giveawayId: number;
  /** Disable mutations (e.g. on cancelled/completed giveaways or for
   *  non-super_admin callers). Reads stay enabled. */
  disabled?: boolean;
  /** Called after an exclusion is added or removed so the parent can
   *  refresh the participants list (excluded users are filtered there). */
  onChange?: () => void;
}

/** Admin panel: manage the per-giveaway exclusion list. Used to keep
 *  the chessr team from winning their own giveaways and to retroactively
 *  ban known bad-faith accounts before a draw. */
export function ExcludedUsersPanel({ giveawayId, disabled, onChange }: Props) {
  const [excluded, setExcluded] = useState<ExcludedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-form local state.
  const [newDiscordId, setNewDiscordId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${giveawayId}/excluded?token=${t}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setExcluded(json.excluded ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [giveawayId]);

  useEffect(() => { load(); }, [load]);

  const ids = useMemo(() => excluded.map((u) => u.discord_id), [excluded]);
  const profiles = useResolvedDiscordUsers(ids);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const discordId = newDiscordId.trim();
    if (!/^\d{17,20}$/.test(discordId)) {
      setError('Discord ID must be 17–20 digits');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${giveawayId}/excluded?token=${t}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId, reason: newReason.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setNewDiscordId('');
      setNewReason('');
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'add failed');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (discordId: string) => {
    setRemoving(discordId);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(
        `/api/admin/giveaways/${giveawayId}/excluded/${discordId}?token=${t}`,
        { method: 'DELETE' },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      await load();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'remove failed');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <ShieldOff size={14} className="text-muted-foreground" />
          Excluded users
          {excluded.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {excluded.length}
            </span>
          )}
        </h3>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Excluded Discord users can&rsquo;t register, can&rsquo;t earn invite tickets, and won&rsquo;t be drawn — useful to keep the chessr team out of their own giveaways.
      </p>

      {error && <div className="rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300">{error}</div>}

      {/* Add form */}
      {!disabled && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Discord ID</label>
            <Input
              value={newDiscordId}
              onChange={(e) => setNewDiscordId(e.target.value)}
              placeholder="123456789012345678"
              className="h-7 w-[180px] font-mono text-[11px]"
              disabled={adding}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Reason (optional)</label>
            <Input
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="chessr team"
              className="h-7 text-[11px]"
              disabled={adding}
            />
          </div>
          <Button type="submit" size="sm" disabled={adding} className="h-7 gap-1">
            {adding ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
            Exclude
          </Button>
        </form>
      )}

      {/* List */}
      {!loading && excluded.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No exclusions yet.</div>
      )}
      {excluded.length > 0 && (
        <div className="space-y-1">
          {excluded.map((u) => {
            const profile = profiles.get(u.discord_id);
            return (
            <div
              key={u.discord_id}
              className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px]"
            >
              {profile?.avatar ? (
                <img
                  src={profile.avatar}
                  alt=""
                  width={20}
                  height={20}
                  className="size-5 shrink-0 rounded-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="size-5 shrink-0 rounded-full bg-muted" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {profile?.username ?? <code className="font-mono">{u.discord_id}</code>}
                </span>
                {profile?.username && (
                  <code className="truncate font-mono text-[9px] text-muted-foreground">
                    {u.discord_id}
                  </code>
                )}
              </div>
              {u.reason && (
                <span className="truncate text-[10px] text-muted-foreground" title={u.reason}>
                  {u.reason}
                </span>
              )}
              {!disabled && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(u.discord_id)}
                  disabled={removing === u.discord_id}
                  className="h-6 w-6 p-0"
                  aria-label="Remove exclusion"
                >
                  {removing === u.discord_id ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </Button>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
