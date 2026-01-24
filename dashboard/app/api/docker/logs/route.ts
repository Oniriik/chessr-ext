import { NextRequest } from 'next/server'
import { createSSHConnection } from '@/lib/ssh'

export async function GET(request: NextRequest) {
  try {
    const lines = request.nextUrl.searchParams.get('lines') || '100'

    const sshConfig = {
      host: process.env.SSH_HOST!,
      username: process.env.SSH_USER!,
      password: process.env.SSH_PASSWORD,
    }

    const conn = await createSSHConnection(sshConfig)

    return new Promise<Response>((resolve) => {
      let logs = ''

      const command = `docker logs --tail ${lines} chess-stockfish-server`

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
          resolve(new Response(JSON.stringify({ logs }), {
            headers: { 'Content-Type': 'application/json' },
          }))
        })

        stream.on('data', (data: Buffer) => {
          logs += data.toString()
        })

        stream.stderr.on('data', (data: Buffer) => {
          logs += data.toString()
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
