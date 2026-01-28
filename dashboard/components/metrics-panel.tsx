'use client'

import { useState, useEffect } from 'react'
import { Users, Activity, Cpu, Clock, Lightbulb, HardDrive, Server } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Progress } from '@/components/ui/progress'

interface Metrics {
  connectedClients: number
  authenticatedUsers: number
  enginePool: {
    total: number
    available: number
    queued: number
  }
  users: Array<{
    id: string
    email: string
    connectedAt: string
    connections?: number
  }>
  suggestionsCount: number
  serverUptime: number
  systemResources: {
    cpuUsage: number
    memoryUsage: {
      used: number
      total: number
      percentage: number
    }
  }
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/metrics')
      const data = await response.json()

      if (data.error) {
        setError(data.error)
      } else {
        setMetrics(data)
        setError('')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 5000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading metrics...
      </div>
    )
  }

  if (error && !metrics) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading metrics: {error}</AlertDescription>
      </Alert>
    )
  }

  const poolUtilization = metrics
    ? Math.round(((metrics.enginePool.total - metrics.enginePool.available) / metrics.enginePool.total) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Server Metrics</h2>
        <span className="text-xs text-muted-foreground">Auto-refreshing every 5s</span>
      </div>

      {/* Server Status */}
      {metrics && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4" />
            <span>Uptime: {formatUptime(metrics.serverUptime)}</span>
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={<Users className="w-5 h-5" />}
          label="Connected Clients"
          value={metrics?.connectedClients || 0}
          color="blue"
        />

        <MetricCard
          icon={<Activity className="w-5 h-5" />}
          label="Authenticated Users"
          value={metrics?.authenticatedUsers || 0}
          color="green"
        />

        <MetricCard
          icon={<Cpu className="w-5 h-5" />}
          label="Chess Engine Instances"
          value={`${metrics?.enginePool.total || 0} / ${metrics?.enginePool.available || 0} avail`}
          color="purple"
        />

        <MetricCard
          icon={<Clock className="w-5 h-5" />}
          label="Queued Requests"
          value={metrics?.enginePool.queued || 0}
          color="orange"
        />

        <MetricCard
          icon={<Lightbulb className="w-5 h-5" />}
          label="Suggestions Served"
          value={metrics?.suggestionsCount || 0}
          color="yellow"
        />

        <MetricCard
          icon={<Cpu className="w-5 h-5" />}
          label="CPU Usage"
          value={`${metrics?.systemResources.cpuUsage || 0}%`}
          color="red"
        />

        <MetricCard
          icon={<HardDrive className="w-5 h-5" />}
          label="RAM Usage"
          value={metrics ? `${formatBytes(metrics.systemResources.memoryUsage.used)} / ${formatBytes(metrics.systemResources.memoryUsage.total)}` : '0 GB'}
          color="cyan"
        />
      </div>

      {/* Resource Utilization */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Engine Pool</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={poolUtilization} className="h-3" />
            <p className="text-xs text-muted-foreground mt-2">{poolUtilization}% in use</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={metrics?.systemResources.cpuUsage || 0} className="h-3" />
            <p className="text-xs text-muted-foreground mt-2">{metrics?.systemResources.cpuUsage || 0}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Memory Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={metrics?.systemResources.memoryUsage.percentage || 0} className="h-3" />
            <p className="text-xs text-muted-foreground mt-2">
              {metrics ? `${formatBytes(metrics.systemResources.memoryUsage.used)} / ${formatBytes(metrics.systemResources.memoryUsage.total)}` : '0 GB'} ({metrics?.systemResources.memoryUsage.percentage || 0}%)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Authenticated Users List */}
      {metrics && metrics.users.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Authenticated Users ({metrics.users.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {metrics.users.map((user) => (
                <div key={user.id} className="flex justify-between items-center text-sm border-b border-border pb-2 last:border-0">
                  <span className="font-medium">
                    {user.email}
                    {user.connections && user.connections > 1 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({user.connections} connections)
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Connected: {new Date(user.connectedAt).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {metrics && metrics.users.length === 0 && (
        <Card>
          <CardContent className="py-4 text-center text-muted-foreground text-sm">
            No authenticated users connected
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: 'blue' | 'green' | 'purple' | 'orange' | 'yellow' | 'red' | 'cyan'
}) {
  const colorClasses = {
    blue: 'bg-blue-500/10 text-blue-500',
    green: 'bg-green-500/10 text-green-500',
    purple: 'bg-purple-500/10 text-purple-500',
    orange: 'bg-orange-500/10 text-orange-500',
    yellow: 'bg-yellow-500/10 text-yellow-500',
    red: 'bg-red-500/10 text-red-500',
    cyan: 'bg-cyan-500/10 text-cyan-500',
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-2">
          <div className={`p-2 rounded-md ${colorClasses[color]}`}>
            {icon}
          </div>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  )
}
