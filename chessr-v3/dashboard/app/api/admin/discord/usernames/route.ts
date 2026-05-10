import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Resolves Discord IDs to handles via the serveur. Reused across admin
// views — wheel tabs today, events page tomorrow.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const serveur = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ usernames: {} });

  const res = await fetch(`${serveur}/admin/discord/usernames${qs ? `?${qs}` : ''}`, {
    headers: { 'x-admin-token': adminToken },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
