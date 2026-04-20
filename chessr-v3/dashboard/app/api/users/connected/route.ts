import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { canAccessDashboard, type UserRole } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qToken = url.searchParams.get('token') || '';
  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/sb-access-token=([^;]+)/);
  const accessToken = bearerToken || qToken || (m ? decodeURIComponent(m[1]) : '');

  if (!accessToken) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
  const supabase = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

  const { data: settings } = await supabase
    .from('user_settings').select('role').eq('user_id', userData.user.id).single();
  const role = (settings?.role as UserRole) || 'user';
  if (!canAccessDashboard(role)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const serveurUrl = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';

  const upstream = await fetch(`${serveurUrl}/admin/users/connected`, {
    headers: { 'X-Admin-Token': adminToken },
  });
  if (!upstream.ok) return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 });
  const body = await upstream.json();
  return NextResponse.json(body);
}
