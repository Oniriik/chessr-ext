import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { getServiceRoleClient } from './supabase';
import { canAccessDashboard, type UserRole } from './roles';

export type AdminContext = {
  supabase: SupabaseClient;
  user: User;
  role: UserRole;
};

function extractToken(req: Request): string {
  const url = new URL(req.url);
  const qToken = url.searchParams.get('token') || '';
  const authHeader = req.headers.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/sb-access-token=([^;]+)/);
  return bearerToken || qToken || (m ? decodeURIComponent(m[1]) : '');
}

// Validates the access token, looks up role, denies non-admins. Returns
// the service-role client (use it for everything past this point) plus
// the caller's identity and role so the route can do tighter checks.
export async function requireAdmin(req: Request): Promise<AdminContext | NextResponse> {
  const accessToken = extractToken(req);
  if (!accessToken) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const supabase = getServiceRoleClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const { data: settings } = await supabase
    .from('user_settings')
    .select('role')
    .eq('user_id', userData.user.id)
    .single();
  const role = ((settings?.role as UserRole) || 'user');
  if (!canAccessDashboard(role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  return { supabase, user: userData.user, role };
}

export function isAdminContext(v: AdminContext | NextResponse): v is AdminContext {
  return (v as AdminContext).user !== undefined;
}

// Re-authenticate the caller by attempting a password sign-in with the
// anon client. Used as a confirmation gate before destructive actions
// (ban/unban/delete). The session token alone isn't enough — we want a
// fresh proof that the human at the keyboard is the admin themselves,
// not someone who walked up to an unlocked dashboard.
export async function verifyAdminPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !email || !password) return false;
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}
