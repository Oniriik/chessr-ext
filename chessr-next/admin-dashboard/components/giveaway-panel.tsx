'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Ticket,
  RefreshCw,
  Loader2,
  Trophy,
  Users,
  CalendarClock,
  Plus,
  StopCircle,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface GiveawayPeriod {
  id: string
  name: string
  starts_at: string
  ends_at: string
  active: boolean
  created_at: string
}

interface InviteEntry {
  inviter_discord_id: string
  inviter_username: string
  count: number
}

interface GiveawayData {
  periods: GiveawayPeriod[]
  activePeriod: GiveawayPeriod | null
  inviteBreakdown: InviteEntry[]
  totalInvites: number
  dailyInvites: { date: string; count: number }[]
}

export function GiveawayPanel() {
  const [data, setData] = useState<GiveawayData | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [stopping, setStopping] = useState(false)

  // New period form
  const [newName, setNewName] = useState('Giveaway')
  const [newEndsAt, setNewEndsAt] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/giveaway', { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch (err) {
      console.error('Failed to fetch giveaway data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const createPeriod = async () => {
    if (!newEndsAt) return
    setCreating(true)
    try {
      const res = await fetch('/api/giveaway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: newName, ends_at: new Date(newEndsAt).toISOString() }),
      })
      if (res.ok) {
        await fetchData()
        setNewName('Giveaway')
        setNewEndsAt('')
      }
    } finally {
      setCreating(false)
    }
  }

  const stopPeriod = async () => {
    setStopping(true)
    try {
      await fetch('/api/giveaway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      await fetchData()
    } finally {
      setStopping(false)
    }
  }

  const activePeriod = data?.activePeriod
  const endsAt = activePeriod ? new Date(activePeriod.ends_at) : null
  const startsAt = activePeriod ? new Date(activePeriod.starts_at) : null
  const isExpired = endsAt ? endsAt < new Date() : false

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div />
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Active Period Status */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ticket className="w-5 h-5 text-indigo-400" />
            Current Giveaway
          </CardTitle>
          <CardDescription>
            {activePeriod ? (isExpired ? 'Period has ended' : 'Active giveaway period') : 'No active giveaway'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activePeriod ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Name</div>
                  <div className="font-bold text-white">{activePeriod.name}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Started</div>
                  <div className="font-bold text-green-400">
                    {startsAt?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Ends</div>
                  <div className={`font-bold ${isExpired ? 'text-red-400' : 'text-amber-400'}`}>
                    {endsAt?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {isExpired && ' (expired)'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Total Invites</div>
                  <div className="font-bold text-indigo-400">{data?.totalInvites || 0}</div>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={stopPeriod}
                disabled={stopping}
                className="border-red-500/50 hover:bg-red-500/20 text-red-400"
              >
                {stopping ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <StopCircle className="w-4 h-4 mr-2" />}
                Stop Giveaway
              </Button>
            </>
          ) : (
            <div className="space-y-4 border border-border/50 rounded-lg p-4 bg-muted/20">
              <div className="text-sm font-medium">Start a new giveaway period</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Giveaway name..."
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs">End Date</Label>
                  <Input
                    type="datetime-local"
                    value={newEndsAt}
                    onChange={(e) => setNewEndsAt(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={createPeriod}
                    disabled={creating || !newEndsAt}
                    className="w-full"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                    Start Giveaway
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invites Chart */}
      {activePeriod && data?.dailyInvites && data.dailyInvites.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-emerald-400" />
              Invites Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.dailyInvites}>
                  <defs>
                    <linearGradient id="gradInvites" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
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
                    name="Invites"
                    stroke="#6366f1"
                    fill="url(#gradInvites)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Leaderboard */}
      {activePeriod && (
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Invite Leaderboard
            </CardTitle>
            <CardDescription>
              Top inviters for this giveaway period (still in server only)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data?.inviteBreakdown && data.inviteBreakdown.length > 0 ? (
              <div className="space-y-2">
                {data.inviteBreakdown.map((entry, i) => (
                  <div
                    key={entry.inviter_discord_id}
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
                      <span className="text-sm font-medium truncate block">{entry.inviter_username}</span>
                    </div>
                    <div className="text-sm font-mono">
                      <span className="font-bold text-indigo-400">{entry.count}</span>
                      <span className="text-muted-foreground ml-1">invite{entry.count > 1 ? 's' : ''}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {1 + entry.count} tickets
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No invites yet for this period</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Past Giveaways */}
      {data?.periods && data.periods.filter(p => !p.active).length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-gray-400" />
              Past Giveaways
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.periods.filter(p => !p.active).map((period) => (
                <div key={period.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 text-sm">
                  <span className="font-medium text-white">{period.name}</span>
                  <span className="text-muted-foreground">
                    {new Date(period.starts_at).toLocaleDateString()} — {new Date(period.ends_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
