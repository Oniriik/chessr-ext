'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';

type Counts = { active: number; waiting: number; completed: number; failed: number; delayed: number };
type FailedJob = {
  id: string | undefined;
  name: string;
  attemptsMade: number;
  failedReason: string;
  finishedOn: number | undefined;
  timestamp: number;
};
type QueueData = { name: string; counts: Counts; failed: FailedJob[] };

const STATE_COLORS: Record<keyof Counts, string> = {
  active:    '#60a5fa',
  waiting:   '#fbbf24',
  completed: '#4ade80',
  failed:    '#f87171',
  delayed:   '#a78bfa',
};

function CountCell({ label, value }: { label: keyof Counts; value: number }) {
  const color = STATE_COLORS[label];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 56 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: 0.05 }}>
        {label}
      </span>
      <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function QueuesPage() {
  const [data, setData] = useState<QueueData[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabase();
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/queues?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setData(json.queues || []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Fetch failed');
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <AdminShell title="Queues">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
          BullMQ — refresh every 3s.
        </p>
        <a
          href="/queues/board"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
        >
          Open Bull Board ↗
        </a>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--error)', padding: 8, borderRadius: 6, background: 'rgba(248,113,113,0.1)' }}>
          {error}
        </div>
      )}

      {!data ? (
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.map((q) => (
            <div key={q.name} className="admin-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ textTransform: 'capitalize', fontSize: 13, color: 'var(--fg)' }}>{q.name}</h2>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>BullMQ queue</span>
              </div>

              <div style={{ display: 'flex', gap: 28 }}>
                {(Object.keys(STATE_COLORS) as (keyof Counts)[]).map((k) => (
                  <CountCell key={k} label={k} value={q.counts[k] ?? 0} />
                ))}
              </div>

              {q.failed.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 10, color: '#f87171', textTransform: 'uppercase', letterSpacing: 0.05, fontWeight: 700, marginBottom: 6 }}>
                    Recent failures
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {q.failed.map((f) => (
                      <div key={f.id} style={{
                        fontSize: 11, padding: '6px 8px', borderRadius: 6,
                        background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.18)',
                        fontFamily: 'ui-monospace, monospace',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)' }}>
                          <span>#{f.id} · {f.name} · attempts {f.attemptsMade}</span>
                          <span>{timeAgo(f.finishedOn || f.timestamp)}</span>
                        </div>
                        <div style={{ color: '#fca5a5', marginTop: 2, wordBreak: 'break-word' }}>
                          {f.failedReason || 'no reason'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
