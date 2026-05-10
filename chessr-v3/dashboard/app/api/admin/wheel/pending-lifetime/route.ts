import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Full list of pending lifetime rewards with owner enrichment. Heavier
// than the count endpoint — hit only when the Pending Lifetime tab is open.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });

  const res = await fetch(`${url}/admin/wheel/pending-lifetime`, {
    headers: { 'x-admin-token': adminToken },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
