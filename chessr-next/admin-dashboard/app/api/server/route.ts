import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Server configuration - path where docker-compose.yml is located
const SERVER_PATH = process.env.SERVER_PATH || '/opt/chessr/app'

// Services that can be controlled
const ALLOWED_SERVICES = ['server', 'admin', 'cron', 'discord-bot']

// Actions that can be performed
const ALLOWED_ACTIONS = ['start', 'stop', 'restart', 'status', 'logs', 'update', 'update-extension']

// Container name mapping
const CONTAINER_NAMES: Record<string, string> = {
  server: 'chessr-server',
  admin: 'chessr-admin',
  cron: 'chessr-cron',
  'discord-bot': 'chessr-discord',
}

async function runCommand(
  command: string,
  timeout = 30000
): Promise<{ stdout: string; stderr: string }> {
  return execAsync(command, { timeout })
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
      case 'update': {
        // Pull latest code, rebuild and restart service(s)
        const pullResult = await runCommand(`cd ${SERVER_PATH} && git pull`, 60000)
        let buildOutput = pullResult.stdout + '\n'

        if (service) {
          // Update single service
          const containerName = CONTAINER_NAMES[service]
          await runCommand(`cd ${SERVER_PATH} && docker rm -f ${containerName} || true`)
          const buildResult = await runCommand(
            `cd ${SERVER_PATH} && docker compose build --no-cache ${service}`,
            300000
          )
          buildOutput += buildResult.stdout + '\n'
          const upResult = await runCommand(`cd ${SERVER_PATH} && docker compose up -d ${service}`)
          buildOutput += upResult.stdout
        } else {
          // Update all services
          for (const svc of ALLOWED_SERVICES) {
            const containerName = CONTAINER_NAMES[svc]
            await runCommand(`cd ${SERVER_PATH} && docker rm -f ${containerName} || true`)
          }
          const buildResult = await runCommand(
            `cd ${SERVER_PATH} && docker compose build --no-cache`,
            600000
          )
          buildOutput += buildResult.stdout + '\n'
          const upResult = await runCommand(`cd ${SERVER_PATH} && docker compose up -d`)
          buildOutput += upResult.stdout
        }

        return NextResponse.json({
          success: true,
          action: 'update',
          service: service || 'all',
          output: buildOutput,
        })
      }
      case 'update-extension': {
        // Build extension package
        const extPath = `${SERVER_PATH}/chessr-next/extension`
        const buildScript = `
          cd ${extPath} && \
          pnpm install && \
          pnpm build && \
          VERSION=$(node -p "require('./package.json').version") && \
          mkdir -p build && \
          cd dist && \
          zip -r "../build/chessr-extension-v\${VERSION}.zip" . && \
          echo "Built chessr-extension-v\${VERSION}.zip"
        `
        const { stdout: extOutput } = await runCommand(buildScript, 120000)
        return NextResponse.json({
          success: true,
          action: 'update-extension',
          output: extOutput,
        })
      }
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
