import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { canAccessDashboard, type UserRole } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Get user settings including role
    const { data: userSettings, error } = await supabase
      .from('user_settings')
      .select('role')
      .eq('user_id', userId)
      .single()

    if (error) {
      console.error('Error fetching user role:', error)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const role = (userSettings?.role as UserRole) || 'user'
    const canAccess = canAccessDashboard(role)

    return NextResponse.json({
      role,
      canAccess,
    })
  } catch (error) {
    console.error('Check role error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
