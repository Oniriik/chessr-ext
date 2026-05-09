import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

// Proxy to the serveur — the actual Paddle SDK call lives there. The
// serveur owns the SDK init + env vars; the dashboard just authenticates
// the admin and forwards the request with the shared admin token.
export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const days = Number(body?.days);
  const reason = typeof body?.reason === 'string' ? body.reason : undefined;
  if (!Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: 'days must be a positive number' }, { status: 400 });
  }

  const serveurUrl = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ error: 'Admin token not configured' }, { status: 500 });

  const res = await fetch(`${serveurUrl}/admin/paddle/extend`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: JSON.stringify({ userId: id, days: Math.floor(days), reason }),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
