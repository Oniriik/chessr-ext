import { NextResponse } from 'next/server';
import { getServiceRoleClient } from '@/lib/supabase';
import { canAccessDashboard, type UserRole } from '@/lib/roles';

export async function POST(req: Request) {
  try {
    const { userId } = await req.json();
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from('user_settings')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('[check-role] supabase error', error);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const role = ((data?.role as UserRole) || 'user');
    const canAccess = canAccessDashboard(role);
    return NextResponse.json({ role, canAccess });
  } catch (err) {
    console.error('[check-role]', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
