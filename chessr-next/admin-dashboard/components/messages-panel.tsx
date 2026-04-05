'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { type UserPlan, planLabels, planColors } from '@/lib/types'
import {
  Mail, Search, Send, Loader2, CheckCircle2, AlertCircle,
  Link2, Eye, MessageSquare, Users, ChevronDown, ChevronUp,
} from 'lucide-react'

interface DiscordUser {
  user_id: string
  discord_id: string
  discord_username: string
  discord_avatar: string | null
  discord_in_guild: boolean
  plan: UserPlan
  email: string
}

interface JobStatus {
  total: number
  sent: number
  failed: number
  failures: { discordId: string; username: string; reason: string }[]
  done: boolean
}

interface DmResponse {
  id: string
  discord_id: string
  discord_username: string
  content: string
  job_id: string | null
  created_at: string
}

const ALL_PLANS: UserPlan[] = ['free', 'freetrial', 'premium', 'beta', 'lifetime']

export function MessagesPanel() {
  // User selection
  const [users, setUsers] = useState<DiscordUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState<UserPlan | ''>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Message composition
  const [mode, setMode] = useState<'write' | 'forward'>('write')
  const [content, setContent] = useState('')
  const [messageLink, setMessageLink] = useState('')
  const [forwardContent, setForwardContent] = useState('')
  const [fetchingPreview, setFetchingPreview] = useState(false)

  // Sending
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [showFailures, setShowFailures] = useState(false)

  // Responses
  const [responses, setResponses] = useState<DmResponse[]>([])
  const [showResponses, setShowResponses] = useState(false)

  const searchTimeout = useRef<NodeJS.Timeout>()

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (planFilter) params.set('plan', planFilter)
      const res = await fetch(`/api/discord/messages?${params}`)
      const data = await res.json()
      setUsers(data.users || [])
    } catch {
      setUsers([])
    }
    setLoading(false)
  }, [search, planFilter])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  // Debounced search
  const handleSearch = (value: string) => {
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setSearch(value), 300)
  }

  // Selection
  const selectableUsers = users.filter(u => u.discord_in_guild)
  const allSelected = selectableUsers.length > 0 && selectableUsers.every(u => selected.has(u.discord_id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectableUsers.map(u => u.discord_id)))
    }
  }

  const toggleUser = (discordId: string) => {
    const next = new Set(selected)
    if (next.has(discordId)) next.delete(discordId)
    else next.add(discordId)
    setSelected(next)
  }

  // Forward preview
  const fetchForwardPreview = async () => {
    if (!messageLink) return
    setFetchingPreview(true)
    try {
      const res = await fetch('/api/discord/messages/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageLink }),
      })
      const data = await res.json()
      if (res.ok) {
        setForwardContent(data.content || '')
      }
    } catch { /* ignore */ }
    setFetchingPreview(false)
  }

  // Send DMs
  const handleSend = async () => {
    setConfirmOpen(false)
    setSending(true)
    setJobStatus(null)
    setShowFailures(false)

    const messageContent = mode === 'forward' ? forwardContent : content
    const discordIds = Array.from(selected)

    try {
      const res = await fetch('/api/discord/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds, content: messageContent }),
      })
      const data = await res.json()
      if (res.ok && data.jobId) {
        setJobId(data.jobId)
      }
    } catch { /* ignore */ }
    setSending(false)
  }

  // Poll job status
  useEffect(() => {
    if (!jobId) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/discord/messages/status?jobId=${jobId}`)
        const data = await res.json()
        if (res.ok) {
          setJobStatus(data)
          if (data.done) clearInterval(interval)
        }
      } catch { /* ignore */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [jobId])

  // Fetch responses when job is done
  useEffect(() => {
    if (!jobStatus?.done || !jobId) return
    const fetchResponses = async () => {
      try {
        const res = await fetch(`/api/discord/messages/responses?jobId=${jobId}`)
        const data = await res.json()
        setResponses(data.responses || [])
      } catch { /* ignore */ }
    }
    fetchResponses()
    // Poll responses every 10s
    const interval = setInterval(fetchResponses, 10000)
    return () => clearInterval(interval)
  }, [jobStatus?.done, jobId])

  const activeMessage = mode === 'forward' ? forwardContent : content
  const canSend = selected.size > 0 && activeMessage.trim().length > 0

  return (
    <div className="space-y-4">
      {/* ── User Selection ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4" />
              Select Recipients
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {selected.size} selected
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by username or email..."
                className="pl-8 h-9"
                onChange={e => handleSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              <Button
                size="sm"
                variant={planFilter === '' ? 'default' : 'ghost'}
                className="h-7 text-xs"
                onClick={() => setPlanFilter('')}
              >
                All
              </Button>
              {ALL_PLANS.map(p => (
                <Button
                  key={p}
                  size="sm"
                  variant={planFilter === p ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setPlanFilter(planFilter === p ? '' : p)}
                >
                  {planLabels[p]}
                </Button>
              ))}
            </div>
          </div>

          {/* Select All */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              id="select-all"
            />
            <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
              Select all ({selectableUsers.length} in guild)
            </label>
          </div>

          {/* User list */}
          <div className="max-h-[300px] overflow-y-auto border border-border/50 rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No users found</p>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border/50">
                  <tr className="text-xs text-muted-foreground">
                    <th className="w-8 p-2" />
                    <th className="text-left p-2">Discord</th>
                    <th className="text-left p-2 hidden sm:table-cell">Email</th>
                    <th className="text-left p-2">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const inGuild = u.discord_in_guild
                    return (
                      <tr
                        key={u.discord_id}
                        className={`border-b border-border/20 ${inGuild ? 'hover:bg-muted/30 cursor-pointer' : 'opacity-40'}`}
                        onClick={() => inGuild && toggleUser(u.discord_id)}
                      >
                        <td className="p-2">
                          <Checkbox
                            checked={selected.has(u.discord_id)}
                            disabled={!inGuild}
                            onCheckedChange={() => toggleUser(u.discord_id)}
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            {u.discord_avatar ? (
                              <img src={u.discord_avatar} className="w-6 h-6 rounded-full" alt="" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                                {u.discord_username?.[0]?.toUpperCase()}
                              </div>
                            )}
                            <span className="text-sm font-medium truncate">{u.discord_username}</span>
                            {!inGuild && <span className="text-[10px] text-muted-foreground">(left)</span>}
                          </div>
                        </td>
                        <td className="p-2 hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground truncate">{u.email}</span>
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className={`text-[10px] ${planColors[u.plan]}`}>
                            {planLabels[u.plan]}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Message Composition ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="w-4 h-4" />
            Compose Message
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Mode toggle */}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={mode === 'write' ? 'default' : 'ghost'}
              className="h-7 text-xs"
              onClick={() => setMode('write')}
            >
              Write
            </Button>
            <Button
              size="sm"
              variant={mode === 'forward' ? 'default' : 'ghost'}
              className="h-7 text-xs gap-1"
              onClick={() => setMode('forward')}
            >
              <Link2 className="w-3 h-3" /> Forward
            </Button>
          </div>

          {mode === 'write' ? (
            <Textarea
              placeholder="Type your message..."
              rows={4}
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="Paste Discord message link..."
                  value={messageLink}
                  onChange={e => setMessageLink(e.target.value)}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={fetchForwardPreview}
                  disabled={fetchingPreview || !messageLink}
                >
                  {fetchingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {forwardContent && (
                <Textarea
                  value={forwardContent}
                  onChange={e => setForwardContent(e.target.value)}
                  rows={4}
                  placeholder="Fetched message content..."
                />
              )}
            </div>
          )}

          {/* Preview */}
          {activeMessage && (
            <div className="border border-border/50 rounded-lg p-4 bg-[#2f3136]">
              <p className="text-xs text-muted-foreground mb-2">Preview</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{activeMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Send & Progress ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="w-4 h-4" />
            Send
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canSend || sending || (jobStatus !== null && !jobStatus.done)}
            className="w-full"
          >
            {sending ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending...</>
            ) : (
              <>Send to {selected.size} user{selected.size !== 1 ? 's' : ''}</>
            )}
          </Button>

          {/* Progress */}
          {jobStatus && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {jobStatus.done ? 'Complete' : 'Sending...'}
                </span>
                <span>
                  <span className="text-emerald-400">{jobStatus.sent}</span>
                  <span className="text-muted-foreground"> / {jobStatus.total}</span>
                  {jobStatus.failed > 0 && (
                    <span className="text-rose-400 ml-2">{jobStatus.failed} failed</span>
                  )}
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${((jobStatus.sent + jobStatus.failed) / jobStatus.total) * 100}%` }}
                />
              </div>

              {jobStatus.done && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">
                    {jobStatus.sent} delivered, {jobStatus.failed} failed
                  </span>
                </div>
              )}

              {/* Failures */}
              {jobStatus.failures.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowFailures(!showFailures)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showFailures ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {jobStatus.failures.length} failure{jobStatus.failures.length !== 1 ? 's' : ''}
                  </button>
                  {showFailures && (
                    <div className="mt-2 space-y-1 max-h-[150px] overflow-y-auto">
                      {jobStatus.failures.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                          <span className="font-medium">{f.username}</span>
                          <span className="text-muted-foreground">— {f.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Responses */}
          {jobStatus?.done && (
            <div>
              <button
                onClick={() => setShowResponses(!showResponses)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <MessageSquare className="w-3 h-3" />
                {showResponses ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                Responses ({responses.length})
              </button>
              {showResponses && (
                <div className="mt-2 space-y-2 max-h-[200px] overflow-y-auto">
                  {responses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No responses yet</p>
                  ) : (
                    responses.map(r => (
                      <div key={r.id} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border border-border/20">
                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                          {r.discord_username?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{r.discord_username}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(r.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Send</DialogTitle>
            <DialogDescription>
              You are about to send a DM to <strong>{selected.size}</strong> user{selected.size !== 1 ? 's' : ''}. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="border border-border/50 rounded-lg p-3 bg-[#2f3136] max-h-[150px] overflow-y-auto">
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{activeMessage}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleSend}>
              <Send className="w-4 h-4 mr-2" /> Send DMs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
