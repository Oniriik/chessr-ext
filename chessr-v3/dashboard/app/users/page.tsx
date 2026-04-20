'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

type ConnectedUser = { userId: string; email: string | null; connectedAt: number };

function formatRelative(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number>(0);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace('/login'); return; }
      setUserEmail(data.session.user.email || null);
    })();
  }, [router]);

  useEffect(() => {
    if (!userEmail) return;
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
  }, [userEmail]);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <strong style={{ fontSize: 14 }}>Chessr v3 <span style={{ color: 'var(--accent)' }}>/ admin</span></strong>
          <nav style={{ display: 'flex', gap: 10, fontSize: 12 }}>
            <a href="/logs">Logs</a>
            <a href="/users" style={{ color: 'var(--fg)', textDecoration: 'underline' }}>Connected users</a>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {userEmail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{userEmail}</span>}
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>
            Connected players · {users.length}
          </h2>
          {lastFetch > 0 && (
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>refreshed {formatRelative(lastFetch)}</span>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--error)', padding: 8, borderRadius: 6, background: 'rgba(248,113,113,0.1)' }}>
            {error}
          </div>
        )}

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.3fr 1fr auto',
            padding: '10px 14px', fontSize: 11, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)',
            background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)',
          }}>
            <span>Email</span>
            <span>User ID</span>
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
                  display: 'grid', gridTemplateColumns: '1.3fr 1fr auto',
                  padding: '10px 14px', fontSize: 12, alignItems: 'center',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--fg)' }}>{u.email || '—'}</span>
                <span style={{ color: 'var(--muted)', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                  {u.userId.slice(0, 8)}…
                </span>
                <span style={{ textAlign: 'right', color: 'var(--muted)' }}>
                  {formatRelative(u.connectedAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
