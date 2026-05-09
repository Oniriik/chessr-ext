import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

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

  return NextResponse.json({ ok: true, email: data.user?.email });
}
