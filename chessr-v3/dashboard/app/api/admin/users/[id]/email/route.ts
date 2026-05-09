import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';
import { emitEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { email } = await req.json().catch(() => ({}));
  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  // Capture old email for the event payload before the update overwrites it.
  const { data: prev } = await ctx.supabase.auth.admin.getUserById(id);
  const oldEmail = prev?.user?.email ?? null;

  // email_confirm: true → mark verified immediately so the user isn't
  // locked out by a pending confirmation email. Admin-driven change.
  const { data, error } = await ctx.supabase.auth.admin.updateUserById(id, {
    email,
    email_confirm: true,
  });
  if (error) {
    console.error('[admin/users/:id/email]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await emitEvent({
    type: 'email_changed',
    user_id: id,
    actor_id: ctx.user.id,
    payload: { oldEmail, newEmail: data.user?.email ?? email },
  });

  return NextResponse.json({ ok: true, email: data.user?.email });
}
