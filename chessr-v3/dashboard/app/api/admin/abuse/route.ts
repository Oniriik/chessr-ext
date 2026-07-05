import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Proxy to the serveur's abuse-scan endpoints — the serveur is the only
// process with both Supabase service access and the analytics DB, so the
// scan runs (and persists) there. GET returns the latest snapshot; POST
// triggers a fresh scan.

function serveurBase(): string {
  return process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
}

function adminHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-admin-token': process.env.SERVEUR_ADMIN_TOKEN || '',
  };
}

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  try {
    const res = await fetch(`${serveurBase()}/admin/abuse/latest`, { headers: adminHeaders(), cache: 'no-store' });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'serveur unreachable' }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  try {
    const res = await fetch(`${serveurBase()}/admin/abuse/scan`, { method: 'POST', headers: adminHeaders() });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'serveur unreachable' }, { status: 502 });
  }
}
