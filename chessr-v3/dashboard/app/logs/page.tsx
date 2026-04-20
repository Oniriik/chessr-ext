'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { ansiToReact } from '@/lib/ansi';

export default function LogsPage() {
  const router = useRouter();
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

  // Auth guard
  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace('/login'); return; }
      setUserEmail(data.session.user.email || null);
    })();
  }, [router]);

  // Connect to SSE stream via our proxy (pass access token as query param —
  // EventSource can't set custom headers and Supabase stores session in
  // localStorage, not cookies).
  useEffect(() => {
    if (!userEmail) return;
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
  }, [userEmail]);

  // Auto-scroll to bottom when new lines arrive (unless user scrolled up)
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

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 20px',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <strong style={{ fontSize: 14 }}>Chessr v3 <span style={{ color: 'var(--accent)' }}>/ admin</span></strong>
          <nav style={{ display: 'flex', gap: 10, fontSize: 12 }}>
            <a href="/metrics">Metrics</a>
            <a href="/logs" style={{ color: 'var(--fg)', textDecoration: 'underline' }}>Logs</a>
            <a href="/users">Connected users</a>
          </nav>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            padding: '2px 8px',
            borderRadius: 999,
            background: connected ? 'rgba(34,197,94,0.18)' : 'rgba(248,113,113,0.18)',
            color: connected ? '#4ade80' : '#f87171',
          }}>
            {connected ? '● live' : '○ offline'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {userEmail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{userEmail}</span>}
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>
            Server logs
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setLines([])}>Clear</button>
          </div>
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
            flex: 1,
            overflow: 'auto',
            background: '#06060d',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
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
      </main>
    </div>
  );
}
