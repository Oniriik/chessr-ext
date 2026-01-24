'use client'

import { useState, useEffect } from 'react'
import { Users, Activity, Cpu, Clock } from 'lucide-react'

interface Metrics {
  connectedClients: number
  authenticatedUsers: number
  stockfishPool: {
    total: number
    available: number
    queued: number
  }
  users: Array<{
    id: string
    email: string
    connectedAt: string
  }>
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
    const interval = setInterval(fetchMetrics, 5000) // Auto-refresh every 5s
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="text-center py-8">Loading metrics...</div>
  }

  if (error && !metrics) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
        Error loading metrics: {error}
      </div>
    )
  }

  const poolUtilization = metrics
    ? Math.round(((metrics.stockfishPool.total - metrics.stockfishPool.available) / metrics.stockfishPool.total) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Server Metrics</h2>
        <span className="text-xs text-gray-500">Auto-refreshing every 5s</span>
      </div>

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
          label="Stockfish Instances"
          value={`${metrics?.stockfishPool.total || 0} / ${metrics?.stockfishPool.available || 0} available`}
          color="purple"
        />

        <MetricCard
          icon={<Clock className="w-5 h-5" />}
          label="Queued Requests"
          value={metrics?.stockfishPool.queued || 0}
          color="orange"
        />
      </div>

      {/* Pool Utilization */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-2">Stockfish Pool Utilization</h3>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div
            className="bg-blue-600 h-4 rounded-full transition-all duration-300"
            style={{ width: `${poolUtilization}%` }}
          />
        </div>
        <p className="text-xs text-gray-600 mt-1">{poolUtilization}% in use</p>
      </div>

      {/* Authenticated Users List */}
      {metrics && metrics.users.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-3">Authenticated Users ({metrics.users.length})</h3>
          <div className="space-y-2">
            {metrics.users.map((user) => (
              <div key={user.id} className="flex justify-between items-center text-sm border-b pb-2">
                <span className="font-medium">{user.email}</span>
                <span className="text-gray-500 text-xs">
                  Connected: {new Date(user.connectedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics && metrics.users.length === 0 && (
        <div className="bg-gray-50 border rounded-lg p-4 text-center text-gray-500 text-sm">
          No authenticated users connected
        </div>
      )}
    </div>
  )
}

function MetricCard({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: number | string
  color: 'blue' | 'green' | 'purple' | 'orange'
}) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  }

  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-2 rounded ${colorClasses[color]}`}>
          {icon}
        </div>
        <span className="text-xs text-gray-600">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
