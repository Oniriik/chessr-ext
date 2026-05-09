import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

const MAX_NOTE_LEN = 5000;

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { note } = await req.json().catch(() => ({}));
  if (typeof note !== 'string') {
    return NextResponse.json({ error: 'note required' }, { status: 400 });
  }
  const trimmed = note.trim();
  if (!trimmed) return NextResponse.json({ error: 'note cannot be empty' }, { status: 400 });
  if (trimmed.length > MAX_NOTE_LEN) {
    return NextResponse.json({ error: `note too long (max ${MAX_NOTE_LEN})` }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from('user_notes')
    .insert({ user_id: id, note: trimmed, created_by: ctx.user.id })
    .select('id, note, created_at, created_by')
    .single();

  if (error) {
    console.error('[admin/users/:id/notes POST]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, note: data });
}
