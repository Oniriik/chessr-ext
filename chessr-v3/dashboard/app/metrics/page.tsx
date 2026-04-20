'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

type Sample = {
  ts: number;
  cpuPct: number;
  memUsed: number;
  memTotal: number;
  memPct: number;
  rss: number;
  load1: number;
  cpuCount: number;
};

const HISTORY = 60; // 60 × 5s = 5 min

function fmtGb(b: number) { return (b / 1024 / 1024 / 1024).toFixed(2); }
function fmtMb(b: number) { return (b / 1024 / 1024).toFixed(0); }

function Sparkline({ values, max, color }: { values: number[]; max: number; color: string }) {
  const w = 240;
  const h = 44;
  if (values.length === 0) return <svg width={w} height={h} />;
  const step = w / Math.max(1, HISTORY - 1);
  const points = values.map((v, i) => {
    const x = (i + (HISTORY - values.length)) * step;
    const y = h - (Math.min(v, max) / max) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={points} />
    </svg>
  );
}

function StatCard({ label, value, sub, history, max, color }: {
  label: string;
  value: string;
  sub?: string;
  history: number[];
  max: number;
  color: string;
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 10, padding: 14,
      background: 'var(--bg-elev)', minWidth: 240,
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
      <div style={{ marginTop: 10 }}>
        <Sparkline values={history} max={max} color={color} />
      </div>
    </div>
  );
}

export default function MetricsPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [latest, setLatest] = useState<Sample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [rssHist, setRssHist] = useState<number[]>([]);
  const [loadHist, setLoadHist] = useState<number[]>([]);

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
        const res = await fetch(`/api/metrics?token=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: Sample = await res.json();
        if (cancelled) return;
        setLatest(json);
        setError(null);
        setCpuHist((h) => [...h, json.cpuPct].slice(-HISTORY));
        setMemHist((h) => [...h, json.memPct].slice(-HISTORY));
        setRssHist((h) => [...h, json.rss / 1024 / 1024].slice(-HISTORY));
        setLoadHist((h) => [...h, json.load1].slice(-HISTORY));
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

  const cpuMax = 100;
  const memMax = 100;
  const rssMax = latest ? Math.max(512, Math.ceil((latest.rss / 1024 / 1024) * 1.3 / 128) * 128) : 512;
  const loadMax = latest ? Math.max(2, latest.cpuCount) : 2;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <strong style={{ fontSize: 14 }}>Chessr v3 <span style={{ color: 'var(--accent)' }}>/ admin</span></strong>
          <nav style={{ display: 'flex', gap: 10, fontSize: 12 }}>
            <a href="/metrics" style={{ color: 'var(--fg)', textDecoration: 'underline' }}>Metrics</a>
            <a href="/logs">Logs</a>
            <a href="/users">Connected users</a>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {userEmail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{userEmail}</span>}
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 14, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--muted)' }}>
          System metrics · updates every 5s
        </h2>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--error)', padding: 8, borderRadius: 6, background: 'rgba(248,113,113,0.1)' }}>
            {error}
          </div>
        )}

        {latest ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <StatCard
              label="CPU"
              value={`${latest.cpuPct.toFixed(1)}%`}
              sub={`${latest.cpuCount} cores`}
              history={cpuHist}
              max={cpuMax}
              color="#6ee7b7"
            />
            <StatCard
              label="Memory (host)"
              value={`${latest.memPct.toFixed(0)}%`}
              sub={`${fmtGb(latest.memUsed)} / ${fmtGb(latest.memTotal)} GB used`}
              history={memHist}
              max={memMax}
              color="#fbbf24"
            />
            <StatCard
              label="Node RSS"
              value={`${fmtMb(latest.rss)} MB`}
              sub="serveur process"
              history={rssHist}
              max={rssMax}
              color="#60a5fa"
            />
            <StatCard
              label="Load (1m)"
              value={latest.load1.toFixed(2)}
              sub={`${latest.cpuCount} cores · saturated at ${latest.cpuCount}`}
              history={loadHist}
              max={loadMax}
              color="#f472b6"
            />
          </div>
        ) : (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
        )}
      </main>
    </div>
  );
}
