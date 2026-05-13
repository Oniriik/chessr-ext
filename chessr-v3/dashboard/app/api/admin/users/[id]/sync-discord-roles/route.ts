import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

const SERVEUR = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
const ADMIN_TOKEN = process.env.SERVEUR_ADMIN_TOKEN || '';

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  // super_admin gate — same standard as the giveaway mutations.
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin required' }, { status: 403 });
  }
  if (!ADMIN_TOKEN) {
    return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const res = await fetch(`${SERVEUR}/admin/users/${id}/sync-discord-roles`, {
    method: 'POST',
    headers: { 'x-admin-token': ADMIN_TOKEN, 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
