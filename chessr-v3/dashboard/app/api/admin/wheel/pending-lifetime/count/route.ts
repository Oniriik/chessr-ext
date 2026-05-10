import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Lightweight count for the sidebar badge. Hit every 30s by AdminShell.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ count: 0 });

  const res = await fetch(`${url}/admin/wheel/pending-lifetime/count`, {
    headers: { 'x-admin-token': adminToken },
    // The badge isn't load-bearing — short timeout, fail-soft to 0.
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);

  if (!res || !res.ok) return NextResponse.json({ count: 0 });
  const data = (await res.json()) as { count?: number };
  return NextResponse.json({ count: data.count ?? 0 });
}
