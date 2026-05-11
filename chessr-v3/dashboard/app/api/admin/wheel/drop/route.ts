import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Proxies POST /admin/wheel/drop on the serveur — triggers a wheel
// token drop in the configured Discord channel. Super-admin only:
// dropping mints a token by definition, so we keep the gate tight.
export async function POST(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const channelId = String(body?.channelId ?? '').trim();
  if (!channelId) {
    return NextResponse.json({ error: 'channelId required' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });

  const res = await fetch(`${url}/admin/wheel/drop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
    body: JSON.stringify({ channelId }),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
