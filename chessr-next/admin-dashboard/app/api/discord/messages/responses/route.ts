import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const supabase = getServiceRoleClient()
    const jobId = request.nextUrl.searchParams.get('jobId')

    let query = supabase
      .from('dm_responses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (jobId) {
      query = query.eq('job_id', jobId)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ responses: data || [] })
  } catch (error) {
    console.error('DM responses error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
