import { NextRequest } from 'next/server'
import { executeCommand } from '@/lib/exec'

const CONTAINER_NAME = process.env.DOCKER_CONTAINER_NAME || 'chess-stockfish-server'

export async function GET(request: NextRequest) {
  try {
    const lines = request.nextUrl.searchParams.get('lines') || '100'

    // Validate lines parameter
    const linesNum = parseInt(lines, 10)
    if (isNaN(linesNum) || linesNum < 1 || linesNum > 1000) {
      return new Response(JSON.stringify({ error: 'Invalid lines parameter (1-1000)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const command = `docker logs --tail ${linesNum} ${CONTAINER_NAME} 2>&1`
    const result = await executeCommand(command)

    const logs = result.stdout + result.stderr

    return new Response(JSON.stringify({ logs: logs || '(no logs)' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
