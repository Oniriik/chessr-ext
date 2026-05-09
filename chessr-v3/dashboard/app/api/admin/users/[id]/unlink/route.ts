import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

// Soft-unlink a single chess platform account. Mirrors the production
// pattern: set `unlinked_at = now()` rather than deleting the row, so the
// existing cooldown index (idx_linked_accounts_unlinked) keeps preventing
// the same chess.com/lichess username from immediately re-linking under a
// different chessr account.
export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { platform, platform_username } = await req.json().catch(() => ({}));
  if (!platform || !platform_username) {
    return NextResponse.json({ error: 'platform and platform_username required' }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from('linked_accounts')
    .update({ unlinked_at: new Date().toISOString() })
    .eq('user_id', id)
    .eq('platform', platform)
    .eq('platform_username', platform_username)
    .is('unlinked_at', null)
    .select('id');

  if (error) {
    console.error('[admin/users/:id/unlink]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Active link not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, unlinked: data.length });
}
