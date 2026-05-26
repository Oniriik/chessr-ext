import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

const serveur = () => process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
const token   = () => process.env.SERVEUR_ADMIN_TOKEN || '';

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const res = await fetch(`${serveur()}/admin/discord/threads`, {
    headers: { 'x-admin-token': token() },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
