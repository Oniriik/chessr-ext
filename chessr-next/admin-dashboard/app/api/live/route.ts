import { NextResponse } from 'next/server'
import os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Store previous CPU snapshot for delta calculation
let prevCpuSnapshot: { idle: number; total: number } | null = null

function getCpuUsage(): number {
  const cpus = os.cpus()
  let idle = 0
  let total = 0

  for (const cpu of cpus) {
    idle += cpu.times.idle
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle
  }

  if (!prevCpuSnapshot) {
    prevCpuSnapshot = { idle, total }
    return 0
  }

  const idleDelta = idle - prevCpuSnapshot.idle
  const totalDelta = total - prevCpuSnapshot.total
  prevCpuSnapshot = { idle, total }

  if (totalDelta === 0) return 0
  return Math.round((1 - idleDelta / totalDelta) * 1000) / 10
}

async function getDiskUsage(): Promise<{ total: number; used: number }> {
  try {
    const { stdout } = await execAsync("df -B1 / | tail -1 | awk '{print $2, $3}'")
    const [total, used] = stdout.trim().split(/\s+/).map(Number)
    return { total: total || 0, used: used || 0 }
  } catch {
    return { total: 0, used: 0 }
  }
}

export async function GET() {
  try {
    const wsServerUrl = process.env.WS_SERVER_URL || 'http://localhost:8080'

    // Machine metrics
    const cpu = getCpuUsage()
    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const disk = await getDiskUsage()

    // Real-time stats from WebSocket server
    let connectedUsers = 0
    let connectedClients = 0
    let users: { id: string; email: string }[] = []
    let pools = null
    let queues = null

    try {
      const res = await fetch(`${wsServerUrl}/stats`, { cache: 'no-store' })
      if (res.ok) {
        const wsStats = await res.json()
        connectedUsers = wsStats.realtime?.connectedUsers ?? 0
        connectedClients = wsStats.realtime?.connectedClients ?? 0
        users = wsStats.realtime?.users ?? []
        pools = wsStats.pools ?? null
        queues = wsStats.queues ?? null
      }
    } catch (err) {
      console.error('Failed to fetch WS server stats:', err)
    }

    return NextResponse.json({
      machine: {
        cpu,
        memory: { total: totalMem, used: totalMem - freeMem },
        disk,
      },
      connectedUsers,
      connectedClients,
      users,
      pools,
      queues,
    })
  } catch (error) {
    console.error('GET live error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
