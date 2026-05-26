import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

const serveur = () => process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
const token   = () => process.env.SERVEUR_ADMIN_TOKEN || '';

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = new URL(req.url);
  const qs = new URLSearchParams();
  const discordId = url.searchParams.get('discordId');
  const before    = url.searchParams.get('before');
  if (discordId) qs.set('discordId', discordId);
  if (before)    qs.set('before', before);

  const res = await fetch(`${serveur()}/admin/discord/dm-history?${qs}`, {
    headers: { 'x-admin-token': token() },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
