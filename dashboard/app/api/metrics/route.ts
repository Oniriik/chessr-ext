import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // When running in Docker, use internal network name
    // When running locally for dev, use the public URL
    const metricsUrl = process.env.METRICS_URL || 'http://chess-server:3001/metrics'

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
