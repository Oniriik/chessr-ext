'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';

type EngineUsage = { source: 'wasm' | 'server'; engine: string | null; ts: number } | null;

type ConnectedUser = {
  userId: string;
  email: string | null;
  connectedAt: number;
  lastSuggestion: EngineUsage;
  lastAnalysis: EngineUsage;
  lastEval: EngineUsage;
};

function formatRelative(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

function ModeBadge({ usage, fallbackLabel }: { usage: EngineUsage; fallbackLabel: string }) {
  if (!usage) {
    return (
      <span style={{
        fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
        background: 'rgba(255,255,255,0.04)', color: 'var(--muted)',
      }}>—</span>
    );
  }
  const isWasm = usage.source === 'wasm';
  const engineLabel = usage.engine || fallbackLabel;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
      background: isWasm ? 'rgba(96,165,250,0.14)' : 'rgba(249,115,22,0.14)',
      color: isWasm ? '#60a5fa' : '#fb923c',
      textTransform: 'uppercase', letterSpacing: 0.04,
    }}>
      <span style={{ opacity: 0.8 }}>{engineLabel}</span>
      <span style={{ opacity: 0.45 }}>·</span>
      <span>{usage.source}</span>
    </span>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/users/connected?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setUsers(json.users || []);
        setLastFetch(Date.now());
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Fetch failed');
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <AdminShell title={`Connected players · ${users.length}`}>
      {lastFetch > 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>refreshed {formatRelative(lastFetch)}</div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: 'var(--error)', padding: 8, borderRadius: 6, background: 'rgba(248,113,113,0.1)' }}>
          {error}
        </div>
      )}

      <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--bg-elev)' }}>
        <div
          style={{
            display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 0.8fr 0.8fr auto',
            padding: '10px 14px', fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span>Email</span>
          <span>Suggestion</span>
          <span>Analysis</span>
          <span>Eval</span>
          <span style={{ textAlign: 'right' }}>Connected</span>
        </div>
        {users.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
            No one connected right now.
          </div>
        ) : (
          users.map((u) => (
            <div
              key={u.userId}
              style={{
                display: 'grid', gridTemplateColumns: '1.4fr 0.8fr 0.8fr 0.8fr auto',
                padding: '10px 14px', fontSize: 12, alignItems: 'center', gap: 8,
                borderTop: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.email || u.userId.slice(0, 8)}
                </span>
                <span style={{ color: 'var(--muted)', fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>
                  {u.userId.slice(0, 8)}…
                </span>
              </div>
              <ModeBadge usage={u.lastSuggestion} fallbackLabel="?" />
              <ModeBadge usage={u.lastAnalysis} fallbackLabel="stockfish" />
              <ModeBadge usage={u.lastEval} fallbackLabel="stockfish" />
              <span style={{ textAlign: 'right', color: 'var(--muted)' }}>
                {formatRelative(u.connectedAt)}
              </span>
            </div>
          ))
        )}
      </div>
    </AdminShell>
  );
}
