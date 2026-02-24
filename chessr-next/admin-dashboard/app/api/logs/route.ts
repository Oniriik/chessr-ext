import { NextResponse } from 'next/server'
import { executeCommand } from '@/lib/exec'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const lines = Math.min(Math.max(parseInt(searchParams.get('lines') || '100'), 1), 1000)
    const containerName = process.env.DOCKER_CONTAINER_NAME || 'chessr-server'

    const command = `docker logs --tail ${lines} ${containerName} 2>&1`
    const { stdout, stderr } = await executeCommand(command)

    // Combine stdout and stderr, as docker logs outputs to both
    const logs = stdout || stderr

    return NextResponse.json({ logs })
  } catch (error) {
    console.error('Get logs error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch logs', logs: '' },
      { status: 500 }
    )
  }
}
