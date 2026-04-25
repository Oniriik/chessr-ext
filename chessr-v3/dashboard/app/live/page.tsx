'use client';

import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
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

const BULLBOARD_URL = process.env.NEXT_PUBLIC_BULLBOARD_URL || '/bullboard/';

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

function modeSummary(users: ConnectedUser[]): { wasm: number; server: number; mixed: number } {
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const [mRes, uRes] = await Promise.all([
          fetch(`/api/metrics?token=${encodeURIComponent(token)}`),
          fetch(`/api/users/connected?token=${encodeURIComponent(token)}`),
        ]);
        if (!mRes.ok || !uRes.ok) throw new Error(`HTTP ${mRes.status}/${uRes.status}`);
        if (cancelled) return;
        setSys(await mRes.json());
        setUsers((await uRes.json()).users || []);
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

      {/* ── Top stat strip ───────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <MiniStat label="Connected" value={String(users.length)} sub={`${modes.wasm} wasm · ${modes.server} server · ${modes.mixed} mixed`} />
        {sys && <>
          <MiniStat label="CPU" value={`${sys.cpuPct.toFixed(0)}%`} sub={`${sys.cpuCount} cores`} />
          <MiniStat label="Memory" value={`${sys.memPct.toFixed(0)}%`} sub={`${fmtGb(sys.memUsed)} / ${fmtGb(sys.memTotal)} GB`} />
          <MiniStat label="RSS" value={`${fmtMb(sys.rss)} MB`} sub="serveur process" />
          <MiniStat label="Load 1m" value={sys.load1.toFixed(2)} />
        </>}
      </div>

      {/* ── Bull Board iframe ───────────────────────────────────── */}
      <div className="admin-card" style={{ flex: 1, padding: 0, minHeight: 360, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.08, color: 'var(--muted)', fontWeight: 700 }}>
            BullMQ queues
          </h2>
          <a
            href={BULLBOARD_URL}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11 }}
          >
            Open <ExternalLink size={11} />
          </a>
        </div>
        <iframe
          src={BULLBOARD_URL}
          style={{ flex: 1, border: 'none', background: '#0a0a14' }}
          title="Bull Board"
        />
      </div>
    </AdminShell>
  );
}
