import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const metricsUrl = process.env.CHESS_METRICS_URL || 'http://135.125.201.246:3001/metrics'

    const response = await fetch(metricsUrl, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`Metrics server returned ${response.status}`)
    }

    const data = await response.json()

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('[Metrics API] Error:', error)
    return NextResponse.json(
      {
        error: error.message,
        connectedClients: 0,
        authenticatedUsers: 0,
        stockfishPool: { total: 0, available: 0, queued: 0 },
        users: [],
      },
      { status: 500 }
    )
  }
}
