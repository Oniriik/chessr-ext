'use client';

import { useState } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';

/**
 * Admin trigger: fires an @everyone wheel-token drop in the configured
 * Discord channel. First click on the bot's embed button wins; the
 * race is decided server-side via an atomic UPDATE so two simultaneous
 * clicks can never both mint a token.
 *
 * Channel ID is sticky in localStorage so the admin doesn't retype it
 * every time. Defaults to NEXT_PUBLIC_DISCORD_WHEEL_CHANNEL_ID when set.
 */

const STORAGE_KEY = 'chessr.dashboard.wheel.dropChannelId';
const DEFAULT_CHANNEL_ID = (
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_DISCORD_WHEEL_CHANNEL_ID : ''
) ?? '';

export function TokenDropButton() {
  const [channelId, setChannelId] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_CHANNEL_ID;
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_CHANNEL_ID;
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'ok'; dropId: number; variant: number }
    | { kind: 'err'; message: string }
    | null
  >(null);

  const handleDrop = async () => {
    const cid = channelId.trim();
    if (!cid) {
      setResult({ kind: 'err', message: 'Channel ID required.' });
      return;
    }
    if (!/^\d{17,20}$/.test(cid)) {
      setResult({ kind: 'err', message: 'Channel ID looks invalid (Discord snowflake = 17–20 digits).' });
      return;
    }
    if (!confirm('Send a token drop with @everyone ping?')) return;

    setBusy(true);
    setResult(null);
    try {
      const sb = getSupabase();
      const { data: sess } = await sb.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setResult({ kind: 'err', message: 'Not signed in.' });
        return;
      }
      localStorage.setItem(STORAGE_KEY, cid);

      const res = await fetch('/api/admin/wheel/drop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channelId: cid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ kind: 'err', message: data?.error || `HTTP ${res.status}` });
        return;
      }
      setResult({ kind: 'ok', dropId: data.dropId, variant: data.variant });
    } catch (err) {
      setResult({ kind: 'err', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-purple-500/10 p-2 text-purple-400">
            <Zap size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">Drop a wheel token</div>
            <div className="text-[11px] text-muted-foreground">
              Pings @everyone in the chosen channel with a "Catch the token" button.
              First click wins — race-safe on the backend.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            placeholder="Discord channel ID (snowflake)"
            className="text-[12px] sm:max-w-[280px]"
          />
          <Button
            type="button"
            onClick={handleDrop}
            disabled={busy}
            className="gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {busy ? 'Dropping…' : 'Drop token'}
          </Button>
        </div>

        {result?.kind === 'ok' && (
          <div className="text-[11px] text-emerald-400">
            ✅ Drop #{result.dropId} posted (variant {result.variant}).
            Watch the channel for the catch.
          </div>
        )}
        {result?.kind === 'err' && (
          <div className="text-[11px] text-destructive">
            {result.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
