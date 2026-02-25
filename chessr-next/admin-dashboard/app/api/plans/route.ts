import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const actionType = searchParams.get('actionType') || 'all'

    const offset = (page - 1) * limit
    const supabase = getServiceRoleClient()

    let query = supabase
      .from('plan_activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (actionType && actionType !== 'all') {
      query = query.eq('action_type', actionType)
    }

    const { data, count, error } = await query

    if (error) {
      console.error('Error fetching plan logs:', error)
      return NextResponse.json({ error: 'Failed to fetch plan logs' }, { status: 500 })
    }

    return NextResponse.json({
      data: data || [],
      total: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error) {
    console.error('GET plans error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
