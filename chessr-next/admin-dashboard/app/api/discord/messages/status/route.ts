import { NextRequest, NextResponse } from 'next/server'

const BOT_INTERNAL_URL = process.env.BOT_INTERNAL_URL || 'http://chessr-discord:3100'

export async function GET(request: NextRequest) {
  try {
    const jobId = request.nextUrl.searchParams.get('jobId')
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const res = await fetch(`${BOT_INTERNAL_URL}/dm-job-status?jobId=${jobId}`)
    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json({ error: data.error || 'Job not found' }, { status: res.status })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('DM job status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
