'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { type UserPlan, planLabels, planColors } from '@/lib/types'
import {
  Mail, Search, Send, Loader2, CheckCircle2, AlertCircle, Inbox,
  Link2, Eye, MessageSquare, Users, ChevronDown, ChevronUp, ArrowLeft,
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

interface Conversation {
  discord_id: string
  discord_username: string
  lastMessage: string
  lastAt: string
  sentCount: number
  receivedCount: number
}

interface ChatMessage {
  id: string
  discord_id: string
  discord_username: string
  content: string
  created_at: string
  direction: 'incoming' | 'outgoing'
}

const ALL_PLANS: UserPlan[] = ['free', 'freetrial', 'premium', 'beta', 'lifetime']

export function MessagesPanel() {
  return (
    <Tabs defaultValue="send" className="space-y-4">
      <TabsList>
        <TabsTrigger value="send" className="gap-1.5">
          <Send className="w-3.5 h-3.5" /> Send
        </TabsTrigger>
        <TabsTrigger value="inbox" className="gap-1.5">
          <Inbox className="w-3.5 h-3.5" /> Inbox
        </TabsTrigger>
      </TabsList>

      <TabsContent value="send">
        <SendTab />
      </TabsContent>
      <TabsContent value="inbox">
        <InboxTab />
      </TabsContent>
    </Tabs>
  )
}

// ─── Send Tab ───

function SendTab() {
  const [users, setUsers] = useState<DiscordUser[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState<UserPlan | ''>('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'write' | 'forward'>('write')
  const [content, setContent] = useState('')
  const [messageLink, setMessageLink] = useState('')
  const [forwardContent, setForwardContent] = useState('')
  const [fetchingPreview, setFetchingPreview] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null)
  const [showFailures, setShowFailures] = useState(false)
  const searchTimeout = useRef<NodeJS.Timeout>()

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (planFilter) params.set('plan', planFilter)
      const res = await fetch(`/api/discord/messages?${params}`)
      const data = await res.json()
      setUsers(data.users || [])
    } catch { setUsers([]) }
    setLoading(false)
  }, [search, planFilter])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleSearch = (value: string) => {
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => setSearch(value), 300)
  }

  const selectableUsers = users.filter(u => u.discord_in_guild)
  const allSelected = selectableUsers.length > 0 && selectableUsers.every(u => selected.has(u.discord_id))

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(selectableUsers.map(u => u.discord_id)))
  }

  const toggleUser = (discordId: string) => {
    const next = new Set(selected)
    if (next.has(discordId)) next.delete(discordId)
    else next.add(discordId)
    setSelected(next)
  }

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
      if (res.ok) setForwardContent(data.content || '')
    } catch { /* ignore */ }
    setFetchingPreview(false)
  }

  const handleSend = async () => {
    setConfirmOpen(false)
    setSending(true)
    setJobStatus(null)
    setShowFailures(false)
    const messageContent = mode === 'forward' ? forwardContent : content
    try {
      const res = await fetch('/api/discord/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds: Array.from(selected), content: messageContent }),
      })
      const data = await res.json()
      if (res.ok && data.jobId) setJobId(data.jobId)
    } catch { /* ignore */ }
    setSending(false)
  }

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

  const activeMessage = mode === 'forward' ? forwardContent : content
  const canSend = selected.size > 0 && activeMessage.trim().length > 0

  return (
    <div className="space-y-4">
      {/* User Selection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4" /> Select Recipients
            </CardTitle>
            <Badge variant="outline" className="text-xs">{selected.size} selected</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by username or email..." className="pl-8 h-9" onChange={e => handleSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              <Button size="sm" variant={planFilter === '' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setPlanFilter('')}>All</Button>
              {ALL_PLANS.map(p => (
                <Button key={p} size="sm" variant={planFilter === p ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setPlanFilter(planFilter === p ? '' : p)}>{planLabels[p]}</Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} id="select-all" />
            <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">Select all ({selectableUsers.length} in guild)</label>
          </div>
          <div className="max-h-[300px] overflow-y-auto border border-border/50 rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No users found</p>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-background border-b border-border/50">
                  <tr className="text-xs text-muted-foreground">
                    <th className="w-8 p-2" /><th className="text-left p-2">Discord</th><th className="text-left p-2 hidden sm:table-cell">Email</th><th className="text-left p-2">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.discord_id} className={`border-b border-border/20 ${u.discord_in_guild ? 'hover:bg-muted/30 cursor-pointer' : 'opacity-40'}`} onClick={() => u.discord_in_guild && toggleUser(u.discord_id)}>
                      <td className="p-2"><Checkbox checked={selected.has(u.discord_id)} disabled={!u.discord_in_guild} onCheckedChange={() => toggleUser(u.discord_id)} /></td>
                      <td className="p-2">
                        <div className="flex items-center gap-2">
                          {u.discord_avatar ? <img src={u.discord_avatar} className="w-6 h-6 rounded-full" alt="" /> : <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">{u.discord_username?.[0]?.toUpperCase()}</div>}
                          <span className="text-sm font-medium truncate">{u.discord_username}</span>
                          {!u.discord_in_guild && <span className="text-[10px] text-muted-foreground">(left)</span>}
                        </div>
                      </td>
                      <td className="p-2 hidden sm:table-cell"><span className="text-xs text-muted-foreground truncate">{u.email}</span></td>
                      <td className="p-2"><Badge variant="outline" className={`text-[10px] ${planColors[u.plan]}`}>{planLabels[u.plan]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Compose */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Mail className="w-4 h-4" /> Compose Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-1">
            <Button size="sm" variant={mode === 'write' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setMode('write')}>Write</Button>
            <Button size="sm" variant={mode === 'forward' ? 'default' : 'ghost'} className="h-7 text-xs gap-1" onClick={() => setMode('forward')}><Link2 className="w-3 h-3" /> Forward</Button>
          </div>
          {mode === 'write' ? (
            <Textarea placeholder="Type your message..." rows={4} value={content} onChange={e => setContent(e.target.value)} />
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input placeholder="Paste Discord message link..." value={messageLink} onChange={e => setMessageLink(e.target.value)} className="flex-1" />
                <Button size="sm" onClick={fetchForwardPreview} disabled={fetchingPreview || !messageLink}>
                  {fetchingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              {forwardContent && <Textarea value={forwardContent} onChange={e => setForwardContent(e.target.value)} rows={4} />}
            </div>
          )}
          {activeMessage && (
            <div className="border border-border/50 rounded-lg p-4 bg-[#2f3136]">
              <p className="text-xs text-muted-foreground mb-2">Preview</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{activeMessage}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Send & Progress */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Send className="w-4 h-4" /> Send</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => setConfirmOpen(true)} disabled={!canSend || sending || (jobStatus !== null && !jobStatus.done)} className="w-full">
            {sending ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Sending...</> : <>Send to {selected.size} user{selected.size !== 1 ? 's' : ''}</>}
          </Button>
          {jobStatus && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{jobStatus.done ? 'Complete' : 'Sending...'}</span>
                <span>
                  <span className="text-emerald-400">{jobStatus.sent}</span>
                  <span className="text-muted-foreground"> / {jobStatus.total}</span>
                  {jobStatus.failed > 0 && <span className="text-rose-400 ml-2">{jobStatus.failed} failed</span>}
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${((jobStatus.sent + jobStatus.failed) / jobStatus.total) * 100}%` }} />
              </div>
              {jobStatus.done && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">{jobStatus.sent} delivered, {jobStatus.failed} failed</span>
                </div>
              )}
              {jobStatus.failures.length > 0 && (
                <div>
                  <button onClick={() => setShowFailures(!showFailures)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
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
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Send</DialogTitle>
            <DialogDescription>You are about to send a DM to <strong>{selected.size}</strong> user{selected.size !== 1 ? 's' : ''}. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="border border-border/50 rounded-lg p-3 bg-[#2f3136] max-h-[150px] overflow-y-auto">
            <p className="text-sm text-gray-300 whitespace-pre-wrap">{activeMessage}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleSend}><Send className="w-4 h-4 mr-2" /> Send DMs</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Inbox Tab ───

function InboxTab() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingChat, setLoadingChat] = useState(false)

  // Fetch conversations list
  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const res = await fetch('/api/discord/messages/conversations')
        const data = await res.json()
        setConversations(data.conversations || [])
      } catch { setConversations([]) }
      setLoading(false)
    }
    fetchConversations()
    const interval = setInterval(fetchConversations, 15000)
    return () => clearInterval(interval)
  }, [])

  // Fetch messages for selected user
  useEffect(() => {
    if (!selectedUser) return
    setLoadingChat(true)
    const fetchMessages = async () => {
      try {
        const res = await fetch(`/api/discord/messages/conversations?discordId=${selectedUser}`)
        const data = await res.json()
        setMessages(data.messages || [])
      } catch { setMessages([]) }
      setLoadingChat(false)
    }
    fetchMessages()
    const interval = setInterval(fetchMessages, 5000)
    return () => clearInterval(interval)
  }, [selectedUser])

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }

  // Conversation view
  if (selectedUser) {
    const conv = conversations.find(c => c.discord_id === selectedUser)
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedUser(null)} className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
              {conv?.discord_username?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold">{conv?.discord_username}</p>
              <p className="text-[10px] text-muted-foreground">{conv?.sentCount} sent · {conv?.receivedCount} received</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingChat && messages.length === 0 ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No messages</p>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {messages.map(m => (
                <div key={m.id} className={`flex ${m.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 ${
                    m.direction === 'outgoing'
                      ? 'bg-primary/20 border border-primary/30'
                      : 'bg-muted/50 border border-border/30'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {new Date(m.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  // Conversations list
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="w-4 h-4" /> Conversations
          <Badge variant="outline" className="text-xs ml-auto">{conversations.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {conversations.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No conversations yet. Send a DM to get started.</p>
        ) : (
          <div className="space-y-1">
            {conversations.map(c => (
              <button
                key={c.discord_id}
                onClick={() => setSelectedUser(c.discord_id)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0">
                  {c.discord_username?.[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{c.discord_username}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(c.lastAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{c.lastMessage}</p>
                </div>
                {c.receivedCount > 0 && (
                  <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/30 shrink-0">
                    {c.receivedCount}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
