import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Super-admin only. Mints N admin_grant tokens for a Discord user.
export async function POST(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const discordId = String(body?.discordId || '').trim();
  const count = Number(body?.count ?? 1);
  const reason = String(body?.reason ?? '').trim();
  if (!discordId)        return NextResponse.json({ error: 'discordId required' }, { status: 400 });
  if (!reason)           return NextResponse.json({ error: 'reason required' }, { status: 400 });
  if (!Number.isFinite(count) || count < 1 || count > 100) {
    return NextResponse.json({ error: 'count must be 1..100' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });

  const res = await fetch(`${url}/admin/wheel/token/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ discordId, count, reason, actorUserId: ctx.user.id }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
