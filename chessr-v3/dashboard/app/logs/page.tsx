'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { ansiToReact } from '@/lib/ansi';
import { AdminShell } from '@/components/AdminShell';

export default function LogsPage() {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      es = new EventSource(`/api/logs/stream?token=${encodeURIComponent(token)}`);
      es.onopen = () => { setConnected(true); setError(null); };
      es.onmessage = (ev) => {
        setLines((prev) => {
          const next = [...prev, ev.data];
          return next.length > 5000 ? next.slice(-5000) : next;
        });
      };
      es.onerror = () => { setConnected(false); setError('Stream disconnected'); };
    })();
    return () => { cancelled = true; es?.close(); };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !autoScroll.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    autoScroll.current = atBottom;
  }

  return (
    <AdminShell title="Logs">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            padding: '2px 8px', borderRadius: 999,
            background: connected ? 'rgba(34,197,94,0.18)' : 'rgba(248,113,113,0.18)',
            color: connected ? '#4ade80' : '#f87171',
          }}
        >
          {connected ? '● live' : '○ offline'}
        </span>
        <button className="btn" onClick={() => setLines([])}>Clear</button>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: 'var(--error)', padding: 8, borderRadius: 6, background: 'rgba(248,113,113,0.1)' }}>
          {error}
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{
          flex: 1, overflow: 'auto',
          background: '#06060d', border: '1px solid var(--border)', borderRadius: 10,
          padding: 12, fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>
            Waiting for log events…
          </div>
        ) : (
          lines.map((l, i) => <div key={i}>{ansiToReact(l)}</div>)
        )}
      </div>
    </AdminShell>
  );
}
