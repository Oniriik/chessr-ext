'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Users, Wifi, Zap, Activity, RefreshCw, Server, AlertTriangle } from 'lucide-react'

interface PoolStats {
  total: number
  available: number
  busy: number
  waiting: number
}

interface Stats {
  realtime: {
    connectedUsers: number
    connectedClients: number
  }
  queues: {
    suggestion: { pending: number; processing: number }
    analysis: { pending: number; processing: number }
  } | null
  pools: {
    komodo: PoolStats | null
    stockfish: PoolStats | null
  } | null
  activity: {
    period: string
    activeUsers: number
    totalRequests: number
    breakdown: {
      suggestions: number
      analyses: number
    }
  }
  global: {
    totalSuggestions: number
    maxWaiting24h: number
  }
}

const TIME_PERIODS = [
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
]

export function InfoPanel() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('24h')

  const fetchStats = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/stats?period=${period}`)
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [period])

  const statCards = [
    {
      title: 'Connected Users',
      value: stats?.realtime.connectedUsers ?? '---',
      description: 'Authenticated users online',
      icon: Users,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'WebSocket Connections',
      value: stats?.realtime.connectedClients ?? '---',
      description: 'Total open connections',
      icon: Wifi,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
    },
    {
      title: 'Active Users',
      value: stats?.activity.activeUsers ?? '---',
      description: `Made a request (${TIME_PERIODS.find((p) => p.value === period)?.label})`,
      icon: Zap,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Total Requests',
      value: stats?.activity.totalRequests ?? '---',
      description: `${stats?.activity.breakdown.suggestions ?? 0} suggestions, ${stats?.activity.breakdown.analyses ?? 0} analyses`,
      icon: Activity,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
  ]

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
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isHighUtilization ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${utilizationPercent}%` }}
              />
            </div>
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
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIME_PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={fetchStats} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="border-border/50 bg-card/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`w-4 h-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
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
            {renderPoolStatus('Komodo (Suggestions)', stats?.pools?.komodo)}
            {renderPoolStatus('Stockfish (Analysis)', stats?.pools?.stockfish)}
          </div>
          {stats?.global.maxWaiting24h !== undefined && stats.global.maxWaiting24h > 0 && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-muted-foreground">Max waiting (24h):</span>
                <span className="font-semibold text-amber-400">
                  {stats.global.maxWaiting24h}
                </span>
                {stats.global.maxWaiting24h >= 5 && (
                  <span className="text-xs text-amber-400 ml-2">Consider scaling up</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Queue Status */}
      {stats?.queues && (
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Queue Status</CardTitle>
            <CardDescription>Current request processing queues</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              {/* Suggestion Queue */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Suggestion Queue</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{stats.queues.suggestion.pending}</p>
                    <p className="text-xs text-muted-foreground">En attente</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Requêtes dans la file
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{stats.queues.suggestion.processing}</p>
                    <p className="text-xs text-muted-foreground">En cours</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Users avec engine actif
                    </p>
                  </div>
                </div>
              </div>

              {/* Analysis Queue */}
              <div className="space-y-3">
                <p className="text-sm font-medium">Analysis Queue</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{stats.queues.analysis.pending}</p>
                    <p className="text-xs text-muted-foreground">En attente</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Requêtes dans la file
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold">{stats.queues.analysis.processing}</p>
                    <p className="text-xs text-muted-foreground">En cours</p>
                    <p className="text-[10px] text-muted-foreground/70">
                      Users avec engine actif
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Global Stats */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Global Statistics</CardTitle>
          <CardDescription>All-time counters</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Total Suggestions Served</p>
              <p className="text-2xl font-bold">
                {stats?.global.totalSuggestions?.toLocaleString() ?? '---'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
