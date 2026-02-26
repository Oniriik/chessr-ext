'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Users, Wifi, Cpu, MemoryStick, HardDrive, RefreshCw, Server, AlertTriangle, Copy, Check } from 'lucide-react'

interface PoolStats {
  total: number
  available: number
  busy: number
  waiting: number
}

interface LiveData {
  machine: {
    cpu: number
    memory: { total: number; used: number }
    disk: { total: number; used: number }
  }
  connectedUsers: number
  connectedClients: number
  users: { id: string; email: string }[]
  pools: {
    komodo: PoolStats | null
    stockfish: PoolStats | null
  } | null
  queues: {
    suggestion: { pending: number; processing: number }
    analysis: { pending: number; processing: number }
  } | null
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  )
}

export function LivePanel() {
  const [data, setData] = useState<LiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch('/api/live')
      if (res.ok) {
        setData(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch live data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLive()
    const interval = setInterval(fetchLive, 5000)
    return () => clearInterval(interval)
  }, [fetchLive])

  const cpuPercent = data?.machine.cpu ?? 0
  const memPercent = data ? Math.round((data.machine.memory.used / data.machine.memory.total) * 100) : 0
  const diskPercent = data?.machine.disk.total ? Math.round((data.machine.disk.used / data.machine.disk.total) * 100) : 0

  const getBarColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 70) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  const renderPoolStatus = (name: string, pool: PoolStats | null | undefined) => {
    if (!pool) return null
    const utilizationPercent = pool.total > 0 ? Math.round((pool.busy / pool.total) * 100) : 0
    const isHighUtilization = utilizationPercent >= 80
    const hasWaiting = pool.waiting > 0

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{name}</p>
          {(isHighUtilization || hasWaiting) && (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>
                {pool.available} / {pool.total} available
              </span>
              <span>{utilizationPercent}%</span>
            </div>
            <ProgressBar
              percent={utilizationPercent}
              color={isHighUtilization ? 'bg-amber-500' : 'bg-emerald-500'}
            />
          </div>
        </div>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>Busy: {pool.busy}</span>
          <span className={hasWaiting ? 'text-amber-400' : ''}>Waiting: {pool.waiting}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-sm text-muted-foreground">Auto-refresh 5s</span>
        </div>
        <Button variant="outline" size="sm" onClick={fetchLive} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Machine Metrics */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* CPU */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">CPU</CardTitle>
            <div className="p-2 rounded-lg bg-orange-500/10">
              <Cpu className="w-4 h-4 text-orange-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{cpuPercent}%</div>
            <ProgressBar percent={cpuPercent} color={getBarColor(cpuPercent)} />
          </CardContent>
        </Card>

        {/* RAM */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">RAM</CardTitle>
            <div className="p-2 rounded-lg bg-purple-500/10">
              <MemoryStick className="w-4 h-4 text-purple-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memPercent}%</div>
            <p className="text-xs text-muted-foreground mb-1">
              {data ? `${formatBytes(data.machine.memory.used)} / ${formatBytes(data.machine.memory.total)}` : '---'}
            </p>
            <ProgressBar percent={memPercent} color={getBarColor(memPercent)} />
          </CardContent>
        </Card>

        {/* Disk */}
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Storage</CardTitle>
            <div className="p-2 rounded-lg bg-blue-500/10">
              <HardDrive className="w-4 h-4 text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{diskPercent}%</div>
            <p className="text-xs text-muted-foreground mb-1">
              {data?.machine.disk.total ? `${formatBytes(data.machine.disk.used)} / ${formatBytes(data.machine.disk.total)}` : '---'}
            </p>
            <ProgressBar percent={diskPercent} color={getBarColor(diskPercent)} />
          </CardContent>
        </Card>
      </div>

      {/* Connections */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Connected Users</CardTitle>
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Users className="w-4 h-4 text-emerald-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.connectedUsers ?? '---'}</div>
            <p className="text-xs text-muted-foreground">Authenticated users online</p>
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">WebSocket Connections</CardTitle>
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <Wifi className="w-4 h-4 text-cyan-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.connectedClients ?? '---'}</div>
            <p className="text-xs text-muted-foreground">Total open connections</p>
          </CardContent>
        </Card>
      </div>

      {/* Engine Pools */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Engine Pools</CardTitle>
          </div>
          <CardDescription>Available engines and utilization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {renderPoolStatus('Komodo (Suggestions)', data?.pools?.komodo)}
            {renderPoolStatus('Stockfish (Analysis)', data?.pools?.stockfish)}
          </div>
        </CardContent>
      </Card>

      {/* Queue Status */}
      {data?.queues && (
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Queue Status</CardTitle>
            <CardDescription>Current request processing queues</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <p className="text-sm font-medium">Suggestion Queue</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{data.queues.suggestion.pending}</p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{data.queues.suggestion.processing}</p>
                    <p className="text-xs text-muted-foreground">Processing</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">Analysis Queue</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{data.queues.analysis.pending}</p>
                    <p className="text-xs text-muted-foreground">Pending</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{data.queues.analysis.processing}</p>
                    <p className="text-xs text-muted-foreground">Processing</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connected Users List */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <CardTitle>Connected Users</CardTitle>
          </div>
          <CardDescription>{data?.users?.length ?? 0} user(s) currently online</CardDescription>
        </CardHeader>
        <CardContent>
          {data?.users && data.users.length > 0 ? (
            <div className="grid gap-2 max-h-[300px] overflow-auto">
              {data.users.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-sm truncate">{user.email}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => copyToClipboard(user.email, `email-${user.id}`)}
                      className="p-1.5 rounded-md hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy email"
                    >
                      {copied === `email-${user.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => copyToClipboard(user.id, `id-${user.id}`)}
                      className="px-2 py-1 rounded-md hover:bg-muted/80 text-xs text-muted-foreground hover:text-foreground font-mono transition-colors"
                      title="Copy user ID"
                    >
                      {copied === `id-${user.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <>{user.id.slice(0, 8)}...</>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No users connected</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
