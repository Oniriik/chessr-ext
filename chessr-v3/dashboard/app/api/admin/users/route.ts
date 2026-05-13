import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = new URL(req.url);
  const search = url.searchParams.get('search')?.trim() || '';
  const planFilter = url.searchParams.get('plan')?.trim() || '';
  const sortByRaw = url.searchParams.get('sortBy')?.trim() || 'joined_at';
  const sortOrderRaw = url.searchParams.get('sortOrder')?.trim().toLowerCase() || 'desc';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10) || 25));
  const offset = (page - 1) * limit;

  const ALLOWED_SORTS = new Set(['joined_at', 'email', 'plan', 'plan_expiry']);
  const ALLOWED_PLANS = new Set(['free', 'freetrial', 'premium', 'beta', 'lifetime', 'unlocker']);
  const sortBy = ALLOWED_SORTS.has(sortByRaw) ? sortByRaw : 'joined_at';
  const sortOrder = sortOrderRaw === 'asc' ? 'asc' : 'desc';
  const plan = ALLOWED_PLANS.has(planFilter) ? planFilter : '';

  const { data, error } = await ctx.supabase.rpc('admin_list_users', {
    p_search: search || null,
    p_plan: plan || null,
    p_sort: sortBy,
    p_order: sortOrder,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('[admin/users] rpc error', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as Array<Record<string, unknown>>) || [];
  const total = Number(rows[0]?.total_count ?? 0);
  const users = rows.map(({ total_count: _ignore, ...rest }) => rest);

  return NextResponse.json({
    users,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}
