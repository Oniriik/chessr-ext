import { NextRequest } from 'next/server'
import { createSSHConnection, createShell } from '@/lib/ssh'

export async function GET(request: NextRequest) {
  // Get the upgrade header to check if this is a WebSocket request
  const upgradeHeader = request.headers.get('upgrade')

  if (upgradeHeader !== 'websocket') {
    return new Response('Expected websocket', { status: 426 })
  }

  // For Next.js, WebSocket upgrade needs to be handled differently
  // This is a simplified version - in production, consider using a separate WebSocket server
  // or a library like 'ws' with Next.js API routes

  return new Response('WebSocket endpoint - use separate WebSocket server or upgrade handler', {
    status: 501,
    headers: {
      'Content-Type': 'text/plain',
    },
  })
}

// Alternative: Use server-sent events for command execution
export async function POST(request: NextRequest) {
  try {
    const { command } = await request.json()

    const sshConfig = {
      host: process.env.SSH_HOST!,
      username: process.env.SSH_USER!,
      password: process.env.SSH_PASSWORD,
    }

    const conn = await createSSHConnection(sshConfig)

    return new Promise<Response>((resolve) => {
      let output = ''

      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end()
          resolve(new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }))
          return
        }

        stream.on('close', () => {
          conn.end()
          resolve(new Response(JSON.stringify({ output }), {
            headers: { 'Content-Type': 'application/json' },
          }))
        })

        stream.on('data', (data: Buffer) => {
          output += data.toString()
        })

        stream.stderr.on('data', (data: Buffer) => {
          output += data.toString()
        })
      })
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
