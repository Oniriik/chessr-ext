import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext, verifyAdminPassword } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }
  if (!ctx.user.email) {
    return NextResponse.json({ error: 'Admin email missing' }, { status: 500 });
  }

  const ok = await verifyAdminPassword(ctx.user.email, password);
  if (!ok) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });

  // Clear ban flags only — we don't restore the prior plan; if they had one
  // before, it's gone (already nulled at ban time). Plan can be set back
  // manually from the sheet.
  const { error } = await ctx.supabase
    .from('user_settings')
    .update({
      banned: false,
      ban_reason: null,
      banned_at: null,
      banned_by: null,
    })
    .eq('user_id', id);
  if (error) {
    console.error('[admin/users/:id/unban]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
