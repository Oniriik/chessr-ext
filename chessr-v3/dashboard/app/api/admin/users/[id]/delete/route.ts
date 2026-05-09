import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext, verifyAdminPassword } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

// Tables we explicitly clear before deleting the auth user. Most have a
// FK with ON DELETE CASCADE to auth.users (e.g. user_notes), so they'd
// vanish anyway when auth.admin.deleteUser runs — but doing it explicitly
// here means we (a) don't depend on every old table's FK definition being
// cascade-set, and (b) get a useful log if any one of them errors.
const TABLES_TO_CLEAR = [
  'user_settings',
  'linked_accounts',
  'signup_ips',
  'user_fingerprints',
  'user_notes',
] as const;

export async function POST(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Refuse to delete yourself — too easy to lock everyone out by accident.
  if (id === ctx.user.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const { password } = await req.json().catch(() => ({}));
  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }
  if (!ctx.user.email) {
    return NextResponse.json({ error: 'Admin email missing' }, { status: 500 });
  }

  const ok = await verifyAdminPassword(ctx.user.email, password);
  if (!ok) return NextResponse.json({ error: 'Invalid password' }, { status: 401 });

  // Capture the email before deletion for the response (and any logging).
  const { data: target } = await ctx.supabase.auth.admin.getUserById(id);
  const targetEmail = target?.user?.email ?? null;

  for (const table of TABLES_TO_CLEAR) {
    const { error } = await ctx.supabase.from(table).delete().eq('user_id', id);
    if (error) {
      // Don't abort — keep going so the auth user still gets deleted. Log
      // for follow-up. Most likely cause: table doesn't exist in this env.
      console.error(`[admin/users/:id/delete] clear ${table}:`, error.message);
    }
  }

  const { error: authErr } = await ctx.supabase.auth.admin.deleteUser(id);
  if (authErr) {
    console.error('[admin/users/:id/delete] auth.deleteUser:', authErr);
    return NextResponse.json({ error: authErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, email: targetEmail });
}
