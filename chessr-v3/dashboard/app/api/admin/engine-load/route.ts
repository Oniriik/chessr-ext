import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Aggregates the serveur's public per-engine load telemetry into one
// payload for the /live page (4 engines, one poll).

const ENGINES = ['komodo', 'maia3', 'rodent', 'stockfish'] as const;

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const base = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  try {
    const results = await Promise.all(ENGINES.map(async (engine) => {
      const res = await fetch(`${base}/engine-load?engine=${engine}`, { cache: 'no-store' });
      if (!res.ok) return { engine, error: true };
      const data = await res.json();
      return { engine, ...data };
    }));
    return NextResponse.json({ engines: results });
  } catch {
    return NextResponse.json({ error: 'serveur unreachable' }, { status: 502 });
  }
}
