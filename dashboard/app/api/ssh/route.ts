import { NextRequest } from 'next/server'
import { executeCommand } from '@/lib/exec'

// Whitelist of allowed commands for security
const ALLOWED_COMMAND_PREFIXES = [
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'grep',
  'docker ps',
  'docker logs',
  'docker stats',
  'docker inspect',
  'df',
  'free',
  'uptime',
  'whoami',
  'date',
  'uname',
]

function isCommandAllowed(command: string): boolean {
  const trimmed = command.trim().toLowerCase()
  return ALLOWED_COMMAND_PREFIXES.some(prefix =>
    trimmed.startsWith(prefix.toLowerCase())
  )
}

export async function POST(request: NextRequest) {
  try {
    const { command } = await request.json()

    if (!command || typeof command !== 'string') {
      return new Response(JSON.stringify({ error: 'Command is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Security: validate command against whitelist
    if (!isCommandAllowed(command)) {
      return new Response(JSON.stringify({
        error: 'Command not allowed. Only read-only and docker commands are permitted.'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const result = await executeCommand(command)
    const output = result.stdout + (result.stderr ? `\n${result.stderr}` : '')

    return new Response(JSON.stringify({ output: output || '(no output)' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
