import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext, verifyAdminPassword } from '@/lib/auth-guard';
import { emitEvent } from '@/lib/events';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { password, reason } = await req.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }
  if (!ctx.user.email) {
    return NextResponse.json({ error: 'Admin email missing' }, { status: 500 });
  }

  const ok = await verifyAdminPassword(ctx.user.email, password);
  if (!ok) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });

  const banReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
  const nowIso = new Date().toISOString();

  // Capture discord_id before the ban update so the event payload lets
  // the bot strip the Premium role from the linked Discord member.
  const { data: prevSettings } = await ctx.supabase
    .from('user_settings')
    .select('discord_id')
    .eq('user_id', id)
    .maybeSingle();

  // Set ban flags + downgrade plan to free (matches chessr-next behavior).
  const { error: updateErr } = await ctx.supabase
    .from('user_settings')
    .upsert({
      user_id: id,
      banned: true,
      ban_reason: banReason,
      banned_at: nowIso,
      banned_by: ctx.user.email,
      plan: 'free',
      plan_expiry: null,
    }, { onConflict: 'user_id' });
  if (updateErr) {
    console.error('[admin/users/:id/ban]', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Soft-unlink any active chess accounts so they free up for cooldown.
  await ctx.supabase
    .from('linked_accounts')
    .update({ unlinked_at: nowIso })
    .eq('user_id', id)
    .is('unlinked_at', null);

  await emitEvent({
    type: 'user_banned',
    user_id: id,
    actor_id: ctx.user.id,
    payload: {
      ...(banReason ? { reason: banReason } : {}),
      ...(prevSettings?.discord_id ? { discordId: prevSettings.discord_id } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
