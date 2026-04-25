'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';

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

const HISTORY = 60;

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
  label: string; value: string; sub?: string;
  history: number[]; max: number; color: string;
}) {
  return (
    <div className="admin-card" style={{ minWidth: 240 }}>
      <h2>{label}</h2>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>}
      <Sparkline values={history} max={max} color={color} />
    </div>
  );
}

export default function MetricsPage() {
  const [latest, setLatest] = useState<Sample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cpuHist, setCpuHist] = useState<number[]>([]);
  const [memHist, setMemHist] = useState<number[]>([]);
  const [rssHist, setRssHist] = useState<number[]>([]);
  const [loadHist, setLoadHist] = useState<number[]>([]);

  useEffect(() => {
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
  }, []);

  const rssMax = latest ? Math.max(512, Math.ceil((latest.rss / 1024 / 1024) * 1.3 / 128) * 128) : 512;
  const loadMax = latest ? Math.max(2, latest.cpuCount) : 2;

  return (
    <AdminShell title="System metrics">
      <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Updates every 5s.</p>

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
            history={cpuHist} max={100} color="#6ee7b7"
          />
          <StatCard
            label="Memory (host)"
            value={`${latest.memPct.toFixed(0)}%`}
            sub={`${fmtGb(latest.memUsed)} / ${fmtGb(latest.memTotal)} GB used`}
            history={memHist} max={100} color="#fbbf24"
          />
          <StatCard
            label="Node RSS"
            value={`${fmtMb(latest.rss)} MB`}
            sub="serveur process"
            history={rssHist} max={rssMax} color="#60a5fa"
          />
          <StatCard
            label="Load (1m)"
            value={latest.load1.toFixed(2)}
            sub={`${latest.cpuCount} cores · saturated at ${latest.cpuCount}`}
            history={loadHist} max={loadMax} color="#f472b6"
          />
        </div>
      ) : (
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
      )}
    </AdminShell>
  );
}
