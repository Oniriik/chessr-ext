import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string; noteId: string }> };

export async function DELETE(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id, noteId } = await params;
  if (!id || !noteId) return NextResponse.json({ error: 'id + noteId required' }, { status: 400 });

  // Scope by user_id too — defense-in-depth so a stale URL with the wrong
  // user_id can't accidentally delete a note that belongs to another user.
  const { data, error } = await ctx.supabase
    .from('user_notes')
    .delete()
    .eq('id', noteId)
    .eq('user_id', id)
    .select('id');

  if (error) {
    console.error('[admin/users/:id/notes/:noteId DELETE]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
