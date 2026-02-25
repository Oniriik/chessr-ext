'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Clock,
  User,
  Bot,
  ArrowRight,
} from 'lucide-react'
import { planLabels, planColors, type UserPlan } from '@/lib/types'

interface PlanActivityLog {
  id: string
  user_id: string
  user_email: string | null
  action_type: 'cron_downgrade' | 'admin_change'
  admin_user_id: string | null
  admin_email: string | null
  old_plan: string | null
  new_plan: string
  old_expiry: string | null
  new_expiry: string | null
  reason: string | null
  created_at: string
}

export function PlansPanel() {
  const [logs, setLogs] = useState<PlanActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [actionTypeFilter, setActionTypeFilter] = useState<string>('all')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      })
      if (actionTypeFilter && actionTypeFilter !== 'all') {
        params.set('actionType', actionTypeFilter)
      }

      const response = await fetch(`/api/plans?${params}`)
      const data = await response.json()

      setLogs(data.data || [])
      setTotalPages(data.totalPages || 1)
      setTotal(data.total || 0)
    } catch (error) {
      console.error('Failed to fetch plan logs:', error)
    } finally {
      setLoading(false)
    }
  }, [page, actionTypeFilter])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  useEffect(() => {
    setPage(1)
  }, [actionTypeFilter])

  const formatRelativeTime = (dateString: string | null) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const getPlanBadge = (plan: string | null) => {
    if (!plan) return <span className="text-muted-foreground">-</span>
    const planKey = plan as UserPlan
    const label = planLabels[planKey] || plan
    const color = planColors[planKey] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
    return <Badge className={color}>{label}</Badge>
  }

  const getActionBadge = (actionType: 'cron_downgrade' | 'admin_change') => {
    if (actionType === 'cron_downgrade') {
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          <Bot className="w-3 h-3 mr-1" />
          Cron
        </Badge>
      )
    }
    return (
      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
        <User className="w-3 h-3 mr-1" />
        Admin
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10">
                <Clock className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{total}</p>
                <p className="text-xs text-muted-foreground">Total logs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-orange-500/10">
                <Bot className="w-4 h-4 text-orange-400" />
              </div>
              <div>
                <p className="text-xl font-bold">
                  {logs.filter((l) => l.action_type === 'cron_downgrade').length}
                </p>
                <p className="text-xs text-muted-foreground">Auto downgrades</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10">
                <User className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold">
                  {logs.filter((l) => l.action_type === 'admin_change').length}
                </p>
                <p className="text-xs text-muted-foreground">Admin changes</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Plan Activity Logs</CardTitle>
            <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={actionTypeFilter} onValueChange={setActionTypeFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="cron_downgrade">Cron downgrades</SelectItem>
                <SelectItem value="admin_change">Admin changes</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Logs table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    Date
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    User
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    Action
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    Plan Change
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    By
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden lg:table-cell">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No plan activity logs found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-3 px-2">
                        <span className="text-sm text-muted-foreground">
                          {formatRelativeTime(log.created_at)}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <span className="text-sm truncate max-w-[200px] block">
                          {log.user_email || log.user_id.slice(0, 8) + '...'}
                        </span>
                      </td>
                      <td className="py-3 px-2">{getActionBadge(log.action_type)}</td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          {getPlanBadge(log.old_plan)}
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          {getPlanBadge(log.new_plan)}
                        </div>
                      </td>
                      <td className="py-3 px-2 hidden md:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {log.action_type === 'admin_change'
                            ? log.admin_email || log.admin_user_id?.slice(0, 8) || '-'
                            : 'System'}
                        </span>
                      </td>
                      <td className="py-3 px-2 hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground">{log.reason || '-'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages} ({total} logs)
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
