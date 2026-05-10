import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

// Lookup any user's inventory. Used from the user detail sheet to
// render the Boost Inventory section.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = new URL(req.url);
  const discordId = url.searchParams.get('discordId');
  if (!discordId) return NextResponse.json({ error: 'discordId required' }, { status: 400 });

  const serveur = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });

  const res = await fetch(
    `${serveur}/admin/wheel/inventory?discordId=${encodeURIComponent(discordId)}`,
    { headers: { 'x-admin-token': adminToken } },
  );
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
