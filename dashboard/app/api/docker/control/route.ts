import { NextRequest, NextResponse } from 'next/server'
import { executeCommand } from '@/lib/exec'

const CONTAINER_NAME = process.env.DOCKER_CONTAINER_NAME || 'chess-stockfish-server'
const ALLOWED_ACTIONS = ['restart', 'stop', 'start'] as const
type Action = typeof ALLOWED_ACTIONS[number]

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json() as { action: string }

    // Security: whitelist allowed actions
    if (!ALLOWED_ACTIONS.includes(action as Action)) {
      return NextResponse.json(
        { error: 'Invalid action. Allowed: restart, stop, start' },
        { status: 400 }
      )
    }

    // Map actions to docker commands
    const commandMap: Record<Action, string> = {
      restart: `docker restart ${CONTAINER_NAME}`,
      stop: `docker stop ${CONTAINER_NAME}`,
      start: `docker start ${CONTAINER_NAME}`,
    }

    const command = commandMap[action as Action]
    const result = await executeCommand(command, 60000) // 60s timeout for docker operations

    // Check if command succeeded (docker outputs container ID on success)
    if (result.stderr && !result.stdout) {
      return NextResponse.json(
        { error: result.stderr },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Container ${action}ed successfully`,
      output: result.stdout.trim(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
