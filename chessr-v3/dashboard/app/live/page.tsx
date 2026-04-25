'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { AdminShell } from '@/components/AdminShell';

type Sample = {
  cpuPct: number;
  memPct: number;
  memUsed: number;
  memTotal: number;
  rss: number;
  load1: number;
  cpuCount: number;
};

type EngineUsage = { source: 'wasm' | 'server'; engine: string | null; ts: number } | null;
type ConnectedUser = {
  userId: string;
  email: string | null;
  connectedAt: number;
  lastSuggestion: EngineUsage;
  lastAnalysis: EngineUsage;
  lastEval: EngineUsage;
};

type Counts = { active: number; waiting: number; completed: number; failed: number; delayed: number };
type QueueData = { name: string; counts: Counts; failed: unknown[] };

function fmtGb(b: number) { return (b / 1024 / 1024 / 1024).toFixed(1); }
function fmtMb(b: number) { return (b / 1024 / 1024).toFixed(0); }

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="admin-card" style={{ padding: '12px 14px', minWidth: 140, gap: 4 }}>
      <h2>{label}</h2>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sub}</div>}
    </div>
  );
}

function modeSummary(users: ConnectedUser[]) {
  let wasm = 0, server = 0, mixed = 0;
  for (const u of users) {
    const sources = [u.lastSuggestion?.source, u.lastAnalysis?.source].filter(Boolean) as string[];
    if (sources.length === 0) continue;
    const allWasm = sources.every((s) => s === 'wasm');
    const allServer = sources.every((s) => s === 'server');
    if (allWasm) wasm++;
    else if (allServer) server++;
    else mixed++;
  }
  return { wasm, server, mixed };
}

export default function LivePage() {
  const [sys, setSys] = useState<Sample | null>(null);
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [queues, setQueues] = useState<QueueData[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const [m, u, q] = await Promise.all([
          fetch(`/api/metrics?token=${encodeURIComponent(token)}`),
          fetch(`/api/users/connected?token=${encodeURIComponent(token)}`),
          fetch(`/api/queues?token=${encodeURIComponent(token)}`),
        ]);
        if (!m.ok || !u.ok || !q.ok) throw new Error(`HTTP ${m.status}/${u.status}/${q.status}`);
        if (cancelled) return;
        setSys(await m.json());
        setUsers((await u.json()).users || []);
        setQueues((await q.json()).queues || []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Fetch failed');
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const modes = modeSummary(users);

  return (
    <AdminShell title="Live">
      {error && (
        <div style={{ fontSize: 12, color: 'var(--error)', padding: 8, borderRadius: 6, background: 'rgba(248,113,113,0.1)' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <MiniStat label="Connected" value={String(users.length)} sub={`${modes.wasm} wasm · ${modes.server} server · ${modes.mixed} mixed`} />
        {sys && <>
          <MiniStat label="CPU" value={`${sys.cpuPct.toFixed(0)}%`} sub={`${sys.cpuCount} cores`} />
          <MiniStat label="Memory" value={`${sys.memPct.toFixed(0)}%`} sub={`${fmtGb(sys.memUsed)} / ${fmtGb(sys.memTotal)} GB`} />
          <MiniStat label="RSS" value={`${fmtMb(sys.rss)} MB`} sub="serveur process" />
          <MiniStat label="Load 1m" value={sys.load1.toFixed(2)} />
        </>}
      </div>

      <div className="admin-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2>BullMQ Queues</h2>
          <Link href="/queues" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            details <ArrowRight size={11} />
          </Link>
        </div>
        {queues.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {queues.map((q) => (
              <div key={q.name} style={{
                border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
                background: 'rgba(255,255,255,0.02)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', marginBottom: 6 }}>{q.name}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                  <span><span style={{ color: '#60a5fa' }}>active</span> {q.counts.active}</span>
                  <span><span style={{ color: '#fbbf24' }}>waiting</span> {q.counts.waiting}</span>
                  <span><span style={{ color: '#4ade80' }}>done</span> {q.counts.completed}</span>
                  <span><span style={{ color: '#f87171' }}>fail</span> {q.counts.failed}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
