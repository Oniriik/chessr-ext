import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data: userRes, error: userErr } = await ctx.supabase.auth.admin.getUserById(id);
  if (userErr || !userRes.user?.email) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const redirectTo = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`
    : undefined;

  // generateLink('recovery') returns the link without sending an email,
  // so we can deliver it through whatever channel the admin prefers.
  // Supabase will *also* send the templated recovery email if that's
  // enabled in your project settings.
  const { data, error } = await ctx.supabase.auth.admin.generateLink({
    type: 'recovery',
    email: userRes.user.email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  if (error) {
    console.error('[admin/users/:id/password-reset]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    email: userRes.user.email,
    actionLink: data.properties?.action_link ?? null,
  });
}
