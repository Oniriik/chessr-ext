import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const { data, error } = await ctx.supabase.rpc('admin_country_distribution');
  if (error) {
    console.error('[admin/users/countries]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as Array<{ country_code: string; country: string; user_count: number }>) || [];
  const total = rows.reduce((s, r) => s + r.user_count, 0);

  return NextResponse.json({
    countries: rows,
    total,
    distinct: rows.length,
  });
}
