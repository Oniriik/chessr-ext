'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Zap, Activity, Users, TrendingUp, Calendar, MessageSquare } from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface TopUser {
  user_id: string
  email: string
  discord_username: string | null
  count: number
}

interface DataResponse {
  totalSuggestionsAllTime: number
  period: {
    suggestions: number
    analyses: number
    activeUsers: number
  }
  timeline: {
    activity: { time: string; suggestions: number; analyses: number }[]
    activeUsers: { time: string; count: number }[]
  }
  topUsers: TopUser[]
}

const TIME_PERIODS = [
  { value: '10mn', label: 'Last 10 min' },
  { value: '30mn', label: 'Last 30 min' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '3h', label: 'Last 3 hours' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '48h', label: 'Last 48 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

function formatTime(iso: string, period: string): string {
  const d = new Date(iso)
  if (period === '30d') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  if (period === '7d') {
    return d.toLocaleDateString('en-US', { weekday: 'short', hour: '2-digit', hour12: false })
  }
  if (period === '48h' || period === '24h') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (period === '6h' || period === '3h' || period === '1h') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (period === '30mn' || period === '10mn') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function DataPanel() {
  const [data, setData] = useState<DataResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('24h')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [discordOnly, setDiscordOnly] = useState(false)

  const isCustom = period === 'custom'

  const fetchData = useCallback(async () => {
    if (isCustom && (!dateFrom || !dateTo)) return

    setLoading(true)
    try {
      const url = isCustom
        ? `/api/data?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`
        : `/api/data?period=${period}`

      const res = await fetch(url)
      if (res.ok) setData(await res.json())
    } catch (err) {
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }, [period, isCustom, dateFrom, dateTo])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const filteredTopUsers = useMemo(() => {
    if (!data?.topUsers) return []
    if (!discordOnly) return data.topUsers
    return data.topUsers.filter((u) => u.discord_username)
  }, [data?.topUsers, discordOnly])

  const statCards = [
    {
      title: 'Total Suggestions',
      value: data?.totalSuggestionsAllTime?.toLocaleString() ?? '---',
      description: 'All time',
      icon: TrendingUp,
      color: 'text-blue-400',
      bgColor: 'bg-blue-500/10',
    },
    {
      title: 'Suggestions',
      value: data?.period.suggestions?.toLocaleString() ?? '---',
      description: isCustom ? 'Custom range' : TIME_PERIODS.find((p) => p.value === period)?.label,
      icon: Zap,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-500/10',
    },
    {
      title: 'Analyses',
      value: data?.period.analyses?.toLocaleString() ?? '---',
      description: isCustom ? 'Custom range' : TIME_PERIODS.find((p) => p.value === period)?.label,
      icon: Activity,
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10',
    },
    {
      title: 'Active Users',
      value: data?.period.activeUsers?.toLocaleString() ?? '---',
      description: 'Users who made a suggestion',
      icon: Users,
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10',
    },
  ]

  const displayPeriod = isCustom ? 'custom' : period

  const activityData = data?.timeline.activity.map((d) => ({
    ...d,
    label: formatTime(d.time, displayPeriod),
  })) || []

  const activeUsersData = data?.timeline.activeUsers.map((d) => ({
    ...d,
    label: formatTime(d.time, displayPeriod),
  })) || []

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[180px]">
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
        {isCustom && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <input
                type="datetime-local"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 px-3 rounded-md border border-border bg-background text-sm"
              />
            </div>
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="datetime-local"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 px-3 rounded-md border border-border bg-background text-sm"
            />
          </div>
        )}
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
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

      {/* Activity Chart */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Suggestions and analyses over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            {activityData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activityData}>
                  <defs>
                    <linearGradient id="gradSuggestions" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradAnalyses" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="suggestions"
                    name="Suggestions"
                    stroke="#10b981"
                    fill="url(#gradSuggestions)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="analyses"
                    name="Analyses"
                    stroke="#a855f7"
                    fill="url(#gradAnalyses)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Users Chart */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Active Users</CardTitle>
          <CardDescription>Unique users who made a suggestion per time bucket</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[250px]">
            {activeUsersData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={activeUsersData}>
                  <defs>
                    <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Active Users"
                    stroke="#06b6d4"
                    fill="url(#gradUsers)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No data for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Top 10 Active Users */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" />
              <CardTitle>Top Active Users</CardTitle>
            </div>
            <Button
              variant={discordOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDiscordOnly(!discordOnly)}
              className="h-7 text-xs gap-1"
            >
              <MessageSquare className="w-3 h-3" />
              Discord only
            </Button>
          </div>
          <CardDescription>Users with the most suggestions in this period</CardDescription>
        </CardHeader>
        <CardContent>
          {filteredTopUsers.length > 0 ? (
            <div className="space-y-2">
              {filteredTopUsers.map((user, i) => (
                <div
                  key={user.user_id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 hover:bg-muted/50"
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                    i === 1 ? 'bg-gray-400/20 text-gray-300' :
                    i === 2 ? 'bg-amber-700/20 text-amber-600' :
                    'bg-muted/50 text-muted-foreground'
                  }`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    {!discordOnly && (
                      <span className="text-sm truncate block">{user.email}</span>
                    )}
                    {user.discord_username && (
                      <span className={`text-indigo-400 truncate block ${discordOnly ? 'text-sm' : 'text-xs'}`}>
                        @{user.discord_username}
                      </span>
                    )}
                    {discordOnly && !user.discord_username && (
                      <span className="text-sm text-muted-foreground truncate block">Unknown</span>
                    )}
                  </div>
                  <div className="text-sm font-mono font-bold text-emerald-400">
                    {user.count}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {discordOnly ? 'No Discord-linked users with suggestions in this period' : 'No suggestions in this period'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
