import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'

// GET - Fetch current maintenance schedule
export async function GET() {
  try {
    const supabase = getServiceRoleClient()
    const { data, error } = await supabase
      .from('global_stats')
      .select('key, value')
      .in('key', ['maintenance_schedule', 'maintenance_schedule_end'])

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }

    const startTs = Number(data?.find((r) => r.key === 'maintenance_schedule')?.value || 0)
    const endTs = Number(data?.find((r) => r.key === 'maintenance_schedule_end')?.value || 0)

    return NextResponse.json({
      scheduled: startTs > 0,
      startTimestamp: startTs,
      endTimestamp: endTs,
    })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST - Schedule maintenance (body: { startTimestamp, endTimestamp } Unix seconds)
export async function POST(request: Request) {
  try {
    const { startTimestamp, endTimestamp } = await request.json()
    if (!startTimestamp || !endTimestamp || typeof startTimestamp !== 'number' || typeof endTimestamp !== 'number') {
      return NextResponse.json({ error: 'Missing start or end timestamp' }, { status: 400 })
    }
    if (endTimestamp <= startTimestamp) {
      return NextResponse.json({ error: 'End must be after start' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()
    const now = new Date().toISOString()

    const { error: e1 } = await supabase
      .from('global_stats')
      .update({ value: startTimestamp, updated_at: now })
      .eq('key', 'maintenance_schedule')

    const { error: e2 } = await supabase
      .from('global_stats')
      .update({ value: endTimestamp, updated_at: now })
      .eq('key', 'maintenance_schedule_end')

    if (e1 || e2) {
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ success: true, startTimestamp, endTimestamp })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// DELETE - Cancel scheduled maintenance
export async function DELETE() {
  try {
    const supabase = getServiceRoleClient()
    const now = new Date().toISOString()

    const { error: e1 } = await supabase
      .from('global_stats')
      .update({ value: 0, updated_at: now })
      .eq('key', 'maintenance_schedule')

    const { error: e2 } = await supabase
      .from('global_stats')
      .update({ value: 0, updated_at: now })
      .eq('key', 'maintenance_schedule_end')

    if (e1 || e2) {
      return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
