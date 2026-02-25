import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Server configuration - path where docker-compose.yml is located
const SERVER_PATH = process.env.SERVER_PATH || '/opt/chessr/app'

// Services that can be controlled
const ALLOWED_SERVICES = ['server', 'admin', 'cron']

// Actions that can be performed
const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'status', 'logs']

async function runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, { timeout: 30000 })
}

export async function GET() {
  try {
    // Get status of all services
    const { stdout } = await runCommand(`cd ${SERVER_PATH} && docker compose ps --format json`)

    // Parse docker compose ps output (one JSON per line)
    const lines = stdout.trim().split('\n').filter(Boolean)
    const services = lines.map(line => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean)

    // Get hostname
    let hostname = 'localhost'
    try {
      const { stdout: hostnameOut } = await runCommand('hostname -I | cut -d" " -f1')
      hostname = hostnameOut.trim() || 'localhost'
    } catch {
      // Ignore hostname errors
    }

    return NextResponse.json({
      services,
      serverHost: hostname,
    })
  } catch (error) {
    console.error('GET server status error:', error)
    return NextResponse.json(
      { error: 'Failed to get server status', details: String(error) },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, service } = body

    // Validate action
    if (!ALLOWED_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate service (if provided)
    if (service && !ALLOWED_SERVICES.includes(service)) {
      return NextResponse.json(
        { error: `Invalid service. Allowed: ${ALLOWED_SERVICES.join(', ')}` },
        { status: 400 }
      )
    }

    let command: string
    const serviceArg = service || ''

    switch (action) {
      case 'start':
        command = `cd ${SERVER_PATH} && docker compose up -d ${serviceArg}`
        break
      case 'stop':
        command = `cd ${SERVER_PATH} && docker compose stop ${serviceArg}`
        break
      case 'restart':
        command = `cd ${SERVER_PATH} && docker compose restart ${serviceArg}`
        break
      case 'status':
        command = `cd ${SERVER_PATH} && docker compose ps ${serviceArg}`
        break
      case 'logs':
        command = `cd ${SERVER_PATH} && docker compose logs --tail=100 ${serviceArg}`
        break
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    const { stdout, stderr } = await runCommand(command)

    return NextResponse.json({
      success: true,
      action,
      service: service || 'all',
      output: stdout,
      stderr: stderr || undefined,
    })
  } catch (error) {
    console.error('POST server control error:', error)
    return NextResponse.json(
      { error: 'Failed to execute command', details: String(error) },
      { status: 500 }
    )
  }
}
