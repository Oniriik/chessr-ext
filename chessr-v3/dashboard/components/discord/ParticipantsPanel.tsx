'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldOff, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authQS } from './giveaway-shared';
import { useResolvedDiscordUsers } from './useResolvedDiscordUsers';

interface Participant {
  discord_id: string;
  tickets: number;
  is_excluded: boolean;
}

interface Props {
  giveawayId: number;
  /** Total participants from the giveaway detail stats — used to title
   *  the panel even before the list resolves. */
  participantCount?: number;
  /** Bumped externally (e.g. after a grant) to force a refresh. */
  refreshSignal?: number;
}

/** Read-only participants list for a giveaway. Each row shows the
 *  Discord ID + their ticket total, sorted by tickets DESC. Excluded
 *  users are rendered with a muted style + badge so admins can spot
 *  who's been blocked from the draw. */
export function ParticipantsPanel({ giveawayId, participantCount, refreshSignal }: Props) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await authQS();
      const res = await fetch(`/api/admin/giveaways/${giveawayId}/participants?token=${t}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setParticipants(json.participants ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [giveawayId]);

  useEffect(() => { load(); }, [load, refreshSignal]);

  const total = participants.reduce((s, p) => s + p.tickets, 0);
  const ids = useMemo(() => participants.map((p) => p.discord_id), [participants]);
  const profiles = useResolvedDiscordUsers(ids);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <Ticket size={14} className="text-muted-foreground" />
          Participants
          {participantCount != null && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
              {participantCount}
            </span>
          )}
        </h3>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="h-7 gap-1 px-2">
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        </Button>
      </div>

      {error && <div className="text-[11px] text-rose-400">{error}</div>}

      {!error && !loading && participants.length === 0 && (
        <div className="text-[11px] text-muted-foreground">No participants yet.</div>
      )}

      {participants.length > 0 && (
        <div className="space-y-1">
          {participants.map((p, idx) => {
            const pct = total > 0 ? (p.tickets / total) * 100 : 0;
            const profile = profiles.get(p.discord_id);
            return (
              <div
                key={p.discord_id}
                className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] tabular-nums ${
                  p.is_excluded ? 'opacity-50 line-through decoration-muted-foreground/40' : ''
                }`}
              >
                <span className="w-6 text-right text-muted-foreground">#{idx + 1}</span>
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
                  <span className="truncate font-medium normal-nums no-underline">
                    {profile?.username ?? <code className="font-mono">{p.discord_id}</code>}
                  </span>
                  {profile?.username && (
                    <code className="truncate font-mono text-[9px] text-muted-foreground">
                      {p.discord_id}
                    </code>
                  )}
                </div>
                {p.is_excluded && (
                  <span className="flex items-center gap-0.5 rounded bg-rose-500/10 px-1.5 py-0.5 text-[9px] text-rose-300 no-underline">
                    <ShieldOff size={9} />
                    excluded
                  </span>
                )}
                <span className="w-12 text-right font-semibold">{p.tickets}</span>
                <span className="w-10 text-right text-[10px] text-muted-foreground">
                  {pct.toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
