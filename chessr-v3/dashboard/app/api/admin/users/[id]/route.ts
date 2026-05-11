import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';
import { emitEvent } from '@/lib/events';
import type { UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

const VALID_PLANS = ['free', 'freetrial', 'premium', 'beta', 'lifetime'] as const;
const VALID_ROLES: UserRole[] = ['super_admin', 'admin', 'user'];

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data, error } = await ctx.supabase.rpc('admin_get_user_detail', { p_user_id: id });
  if (error) {
    console.error('[admin/users/:id] rpc error', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Subscription summary — added separately from the RPC so the SQL
  // function doesn't need to know about the paddle table. The detail
  // sheet uses this to switch between "extend Paddle sub" and the
  // direct plan_expiry editor for non-Paddle plans.
  const { data: sub } = await ctx.supabase
    .from('subscriptions')
    .select('paddle_subscription_id, status, current_period_end, canceled_at, interval')
    .eq('user_id', id)
    .maybeSingle();

  return NextResponse.json({ ...data, subscription: sub || null });
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const { plan, role, plan_expiry } = body as {
    plan?: string;
    role?: UserRole;
    plan_expiry?: string | null;
  };

  // Pull current values for the event diff payload before we mutate.
  // discord_id is included so the bot can sync the corresponding Discord
  // role on plan_changed without a follow-up Supabase round-trip.
  const { data: prev } = await ctx.supabase
    .from('user_settings')
    .select('plan, plan_expiry, role, discord_id')
    .eq('user_id', id)
    .maybeSingle();

  if (role !== undefined && ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'Only super_admin can change roles' }, { status: 403 });
  }
  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  if (plan !== undefined && !VALID_PLANS.includes(plan as typeof VALID_PLANS[number])) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }
  if (plan_expiry !== undefined && plan_expiry !== null) {
    const t = Date.parse(plan_expiry);
    if (Number.isNaN(t)) return NextResponse.json({ error: 'Invalid plan_expiry' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (plan !== undefined) update.plan = plan;
  if (role !== undefined) update.role = role;
  if (plan_expiry !== undefined) update.plan_expiry = plan_expiry;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No changes' }, { status: 400 });
  }

  // Upsert: a fresh user might not have a user_settings row yet.
  const { error } = await ctx.supabase
    .from('user_settings')
    .upsert({ user_id: id, ...update }, { onConflict: 'user_id' });
  if (error) {
    console.error('[admin/users/:id] update error', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Emit one event per concern that actually changed. Plan + expiry get
  // collapsed into a single 'plan_changed' since they're set together
  // from the UI; role stands alone.
  if (plan !== undefined || plan_expiry !== undefined) {
    const oldPlan = prev?.plan ?? 'free';
    const newPlan = plan ?? prev?.plan ?? 'free';
    const oldExpiry = prev?.plan_expiry ?? null;
    const newExpiry = plan_expiry ?? prev?.plan_expiry ?? null;

    await emitEvent({
      type: 'plan_changed',
      user_id: id,
      actor_id: ctx.user.id,
      payload: {
        oldPlan, newPlan, oldExpiry, newExpiry,
        discordId: prev?.discord_id ?? null,
        reason: 'admin_override',
      },
    });

    // Mirror the Paddle handler's lifecycle taxonomy so admin-side plan
    // overrides also light up the mod channel. The bot's forwarder
    // listens to these (not plan_changed) so without them, manual
    // promotions/cancellations would be silent.
    const FREE_TIERS = new Set(['free', 'freetrial']);
    const PAID_TIERS = new Set(['premium', 'lifetime']);
    if (oldPlan !== newPlan) {
      if (FREE_TIERS.has(oldPlan) && PAID_TIERS.has(newPlan)) {
        await emitEvent({
          type: 'new_customer',
          user_id: id,
          actor_id: ctx.user.id,
          payload: { plan: newPlan, newExpiry, reason: 'admin_override' },
        });
      } else if (PAID_TIERS.has(oldPlan) && newPlan === 'free') {
        await emitEvent({
          type: 'customer_canceled',
          user_id: id,
          actor_id: ctx.user.id,
          payload: {
            plan: oldPlan, expiresAt: null,
            scheduled: false, reason: 'admin_override',
          },
        });
      }
    } else if (
      newPlan === 'premium' && oldExpiry && newExpiry &&
      new Date(newExpiry).getTime() > new Date(oldExpiry).getTime()
    ) {
      // Same plan, expiry pushed forward = renewal (manual extension).
      await emitEvent({
        type: 'customer_renewed',
        user_id: id,
        actor_id: ctx.user.id,
        payload: { plan: newPlan, oldExpiry, newExpiry, reason: 'admin_override' },
      });
    }
  }
  if (role !== undefined && role !== prev?.role) {
    await emitEvent({
      type: 'role_changed',
      user_id: id,
      actor_id: ctx.user.id,
      payload: { oldRole: prev?.role ?? 'user', newRole: role },
    });
  }

  return NextResponse.json({ ok: true });
}
