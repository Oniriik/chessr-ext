import { NextRequest, NextResponse } from 'next/server'
import { createSSHConnection, executeCommand } from '@/lib/ssh'

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

    const sshConfig = {
      host: process.env.SSH_HOST!,
      username: process.env.SSH_USER!,
      password: process.env.SSH_PASSWORD,
    }

    const conn = await createSSHConnection(sshConfig)

    // Map actions to docker commands
    const commandMap: Record<Action, string> = {
      restart: 'docker restart chess-stockfish-server',
      stop: 'docker stop chess-stockfish-server',
      start: 'docker start chess-stockfish-server',
    }

    const command = commandMap[action as Action]

    const result = await executeCommand(conn, command)
    conn.end()

    if (result.code === 0) {
      return NextResponse.json({
        success: true,
        message: `Container ${action}ed successfully`,
        output: result.stdout,
      })
    } else {
      return NextResponse.json(
        { error: result.stderr || 'Command failed', output: result.stdout },
        { status: 500 }
      )
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
