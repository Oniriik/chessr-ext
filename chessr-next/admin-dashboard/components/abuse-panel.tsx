'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ShieldAlert, RefreshCw, Loader2, Copy, Check, Globe, Fingerprint, Users, Ban, Trash2, Search, XCircle, CheckCircle2, MessageSquare, MessageSquarePlus, Send, X } from 'lucide-react'
import { formatRelativeTime } from '@/lib/format'
import { toast } from 'sonner'
import type { UserRole } from '@/lib/types'

interface AbuseUser {
  id: string
  email: string
  created_at: string
  plan: string
  freetrial_used: boolean
  discord_id: string | null
  discord_username: string | null
  banned: boolean
  email_confirmed: boolean
}

interface AbuseNote {
  id: string
  author_id: string
  author_name: string
  message: string
  created_at: string
}

interface AbuseGroup {
  id: string
  types: string[]
  status: 'open' | 'closed'
  reasons: string[]
  users: AbuseUser[]
  fingerprints: string[]
  ips: { ip: string; country: string | null; country_code: string | null }[]
  notes: AbuseNote[]
  created_at: string
  updated_at: string
  closed_at: string | null
}

interface AbusePanelProps {
  userRole: UserRole
  userId: string
  userEmail: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={handleCopy} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
      <code className="text-xs font-mono">{text}</code>
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

function NotesSection({ notes, caseId, currentUserId, onAddNote, onDeleteNote }: {
  notes: AbuseNote[]
  caseId: string
  currentUserId: string
  onAddNote: (caseId: string, message: string) => Promise<void>
  onDeleteNote: (caseId: string, noteId: string) => Promise<void>
}) {
  const [showInput, setShowInput] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSubmitting(true)
    await onAddNote(caseId, message.trim())
    setMessage('')
    setShowInput(false)
    setSubmitting(false)
  }

  return (
    <div className="border-t border-border/30 pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <MessageSquare className="w-3 h-3" /> Notes {notes.length > 0 && `(${notes.length})`}
        </span>
        {!showInput && (
          <Button variant="ghost" size="sm" onClick={() => setShowInput(true)} className="h-6 px-2 text-[11px] text-muted-foreground">
            + Add note
          </Button>
        )}
      </div>

      {notes.map(note => (
        <div key={note.id} className="flex items-start gap-2 p-2 rounded bg-muted/20 border border-border/20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-foreground">{note.author_name}</span>
              <span className="text-[10px] text-muted-foreground">{formatRelativeTime(note.created_at)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{note.message}</p>
          </div>
          {note.author_id === currentUserId && (
            <Button variant="ghost" size="sm" onClick={() => onDeleteNote(caseId, note.id)} className="h-5 w-5 p-0 text-muted-foreground hover:text-red-400 flex-shrink-0">
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      ))}

      {showInput && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Add a note..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            className="h-8 text-xs"
            autoFocus
          />
          <Button variant="ghost" size="sm" onClick={handleSubmit} disabled={submitting || !message.trim()} className="h-8 w-8 p-0">
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowInput(false); setMessage('') }} className="h-8 w-8 p-0 text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

const planColors: Record<string, string> = {
  free: 'bg-zinc-500/20 text-zinc-400',
  freetrial: 'bg-blue-500/20 text-blue-400',
  premium: 'bg-amber-500/20 text-amber-400',
  lifetime: 'bg-purple-500/20 text-purple-400',
  beta: 'bg-emerald-500/20 text-emerald-400',
}

const BAN_TEMPLATES = [
  'Multi-account abuse',
  'Free trial abuse',
  'Terms of Service violation',
  'Suspicious activity',
]

type StatusFilter = 'open' | 'closed' | 'all'

function getInitialSearch(): string {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  return params.get('filter') || ''
}

function updateUrlFilter(search: string) {
  const oldParams = new URLSearchParams(window.location.search)
  const newParams = new URLSearchParams()
  // tab always first
  const tab = oldParams.get('tab')
  if (tab) newParams.set('tab', tab)
  // then filter
  if (search.trim()) newParams.set('filter', search.trim())
  // carry over other params
  oldParams.forEach((value, key) => {
    if (key === 'tab' || key === 'filter') return
    newParams.set(key, value)
  })
  const qs = newParams.toString()
  window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname)
}

export function AbusePanel({ userRole, userId, userEmail }: AbusePanelProps) {
  const [groups, setGroups] = useState<AbuseGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [emailSearch, setEmailSearch] = useState(getInitialSearch)

  // Ban dialog state
  const [banTarget, setBanTarget] = useState<{ users: AbuseUser[]; label: string } | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banning, setBanning] = useState(false)

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<AbuseUser | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/abuse')
      if (res.ok) {
        const data = await res.json()
        setGroups(data.groups || [])
      }
    } catch (err) {
      console.error('Failed to fetch abuse data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleScan = async () => {
    setScanning(true)
    try {
      const res = await fetch('/api/abuse', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setGroups(data.groups || [])
        toast.success(`Scan complete: ${data.created} new, ${data.updated} updated`)
      } else {
        toast.error('Scan failed')
      }
    } catch {
      toast.error('Scan failed')
    } finally {
      setScanning(false)
    }
  }

  const handleCloseCase = async (caseId: string) => {
    try {
      const res = await fetch('/api/abuse', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: caseId, action: 'set_status', status: 'closed', admin_id: userId }),
      })
      if (res.ok) {
        setGroups(prev => prev.map(g => g.id === caseId ? { ...g, status: 'closed', closed_at: new Date().toISOString() } : g))
        toast.success('Case closed')
      }
    } catch { toast.error('Failed to close case') }
  }

  const handleReopenCase = async (caseId: string) => {
    try {
      const res = await fetch('/api/abuse', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: caseId, action: 'set_status', status: 'open', admin_id: userId }),
      })
      if (res.ok) {
        setGroups(prev => prev.map(g => g.id === caseId ? { ...g, status: 'open', closed_at: null } : g))
        toast.success('Case reopened')
      }
    } catch { toast.error('Failed to reopen case') }
  }

  const handleAddNote = async (caseId: string, message: string) => {
    try {
      const res = await fetch('/api/abuse', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: caseId, action: 'add_note', author_id: userId, author_name: userEmail, message }),
      })
      if (res.ok) {
        const data = await res.json()
        setGroups(prev => prev.map(g => g.id === caseId ? { ...g, notes: data.notes } : g))
      }
    } catch { toast.error('Failed to add note') }
  }

  const handleDeleteNote = async (caseId: string, noteId: string) => {
    try {
      const res = await fetch('/api/abuse', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: caseId, action: 'delete_note', note_id: noteId, author_id: userId }),
      })
      if (res.ok) {
        const data = await res.json()
        setGroups(prev => prev.map(g => g.id === caseId ? { ...g, notes: data.notes } : g))
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete note')
      }
    } catch { toast.error('Failed to delete note') }
  }

  const confirmBan = async () => {
    if (!banTarget) return
    setBanning(true)
    try {
      for (const user of banTarget.users) {
        if (user.banned) continue
        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id, callerRole: userRole, adminUserId: userId,
            adminEmail: userEmail, userEmail: user.email, banned: true,
            banReason: banReason || 'Multi-account abuse',
          }),
        })
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || `Failed to ban ${user.email}`) }
      }
      toast.success(`Banned ${banTarget.users.filter(u => !u.banned).length} user(s)`)
      setBanTarget(null); setBanReason('')
      await fetchData()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to ban') }
    finally { setBanning(false) }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || !deletePassword) return
    setDeleting(true); setDeleteError('')
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: deleteTarget.id, adminEmail: userEmail, adminPassword: deletePassword, callerRole: userRole }),
      })
      const data = await res.json()
      if (!res.ok) { setDeleteError(data.error || 'Failed to delete user'); return }
      toast.success(`Deleted ${deleteTarget.email}`)
      setDeleteTarget(null); setDeletePassword('')
      await fetchData()
    } catch { setDeleteError('Network error') }
    finally { setDeleting(false) }
  }

  const handleOpenTicket = async (user: AbuseUser, group: AbuseGroup) => {
    if (!user.discord_id) { toast.error('User has no Discord linked'); return }
    try {
      const emails = group.users.map(u => u.email)
      const filterParam = encodeURIComponent(emails.join(','))
      const dashboardLink = `https://dashboard.chessr.io/?tab=abuse&filter=${filterParam}`
      const res = await fetch('/api/abuse/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordId: user.discord_id, abuseTypes: group.types, dashboardLink }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to create ticket'); return }
      if (data.existing) { toast.info('Ticket already exists for this user'); return }
      toast.success(`Ticket created for ${user.email}`)
    } catch { toast.error('Failed to create ticket') }
  }

  const openBanAll = (group: AbuseGroup) => {
    const unbanned = group.users.filter(u => !u.banned)
    if (unbanned.length === 0) { toast.info('All users already banned'); return }
    setBanTarget({ users: unbanned, label: `${unbanned.length} user(s) in this group` }); setBanReason('')
  }

  const openBanSingle = (user: AbuseUser) => {
    if (user.banned) { toast.info('User already banned'); return }
    setBanTarget({ users: [user], label: user.email }); setBanReason('')
  }

  const openDelete = (user: AbuseUser) => {
    setDeleteTarget(user); setDeletePassword(''); setDeleteError('')
  }

  function typePriority(types: string[] | undefined): number {
    if (!types) return 3
    const hasMa = types.includes('multi_account')
    const hasVpn = types.includes('vpn')
    if (hasMa && hasVpn) return 0
    if (hasMa) return 1
    if (hasVpn) return 2
    return 3
  }

  const searchEmails = emailSearch.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)

  const handleSearchChange = (value: string) => {
    setEmailSearch(value)
    updateUrlFilter(value)
  }

  const filtered = groups
    .filter(g => statusFilter === 'all' || g.status === statusFilter)
    .filter(g => searchEmails.length === 0 || g.users.some(u => searchEmails.some(e => u.email.toLowerCase().includes(e))))
    .slice().sort((a, b) => typePriority(a.types) - typePriority(b.types))
  const openCount = groups.filter(g => g.status === 'open').length
  const closedCount = groups.filter(g => g.status === 'closed').length
  const totalAccounts = new Set(filtered.flatMap(g => g.users.map(u => u.id))).size
  const multiAccountCount = filtered.filter(g => g.types.includes('multi_account')).length
  const vpnCount = filtered.filter(g => g.types.includes('vpn')).length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          Abuse Detection
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning} className="gap-1.5">
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Scan Abuse
          </Button>
          <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Email search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="user@mail.com, other@mail.com"
          value={emailSearch}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
        {emailSearch && (
          <Button variant="ghost" size="sm" onClick={() => handleSearchChange('')} className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {/* Filter tabs + Summary */}
      {!loading && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1.5">
            {(['open', 'closed', 'all'] as StatusFilter[]).map(f => (
              <Button
                key={f}
                variant={statusFilter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(f)}
                className="h-7 text-xs capitalize"
              >
                {f}
                {f === 'open' && openCount > 0 && <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-red-500/20 text-red-400">{openCount}</Badge>}
                {f === 'closed' && closedCount > 0 && <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-zinc-500/20 text-zinc-400">{closedCount}</Badge>}
                {f === 'all' && groups.length > 0 && <Badge className="ml-1.5 h-4 px-1 text-[10px]" variant="outline">{groups.length}</Badge>}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs py-0.5 px-2">
              <Users className="w-3 h-3 mr-1" />
              {totalAccounts} account{totalAccounts !== 1 ? 's' : ''}
            </Badge>
            {multiAccountCount > 0 && (
              <Badge className="text-xs py-0.5 px-2 bg-red-500/20 text-red-400 border-red-500/30">
                {multiAccountCount} multi-account
              </Badge>
            )}
            {vpnCount > 0 && (
              <Badge className="text-xs py-0.5 px-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                {vpnCount} VPN
              </Badge>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && groups.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Groups */}
      {filtered.map((group) => (
        <Card key={group.id} className={`border-border/50 bg-card/50 ${group.status === 'closed' ? 'opacity-60' : ''}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {group.types.includes('multi_account') && (
                  <Badge className={group.status === 'open' ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}>
                    Multi-Account
                  </Badge>
                )}
                {group.types.includes('vpn') && (
                  <Badge className={group.status === 'open' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'}>
                    VPN Usage
                  </Badge>
                )}
                <Badge variant="outline" className={`text-[10px] ${group.status === 'open' ? 'text-red-400 border-red-500/30' : 'text-green-400 border-green-500/30'}`}>
                  {group.status}
                </Badge>
                {group.reasons.map((reason, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] text-muted-foreground">
                    {reason}
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">Updated {formatRelativeTime(group.updated_at)}</span>
                {group.status === 'open' ? (
                  <>
                    {group.users.some(u => !u.banned) && (
                      <Button variant="outline" size="sm" onClick={() => openBanAll(group)} className="h-7 px-2 text-xs text-red-400 border-red-500/30 hover:bg-red-500/10">
                        <Ban className="w-3 h-3 mr-1" /> Ban All
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => handleCloseCase(group.id)} className="h-7 px-2 text-xs text-green-400 border-green-500/30 hover:bg-green-500/10">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Close Case
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => handleReopenCase(group.id)} className="h-7 px-2 text-xs text-muted-foreground">
                    <XCircle className="w-3 h-3 mr-1" /> Reopen
                  </Button>
                )}
              </div>
            </div>
            {group.types.includes('multi_account') && group.users[0] && (
              <p className="text-xs text-muted-foreground mt-1">
                First account: <span className="text-foreground font-medium">{group.users[0].email}</span>
                <span className="ml-2 opacity-60">{formatRelativeTime(group.users[0].created_at)}</span>
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {group.users.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/30">
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{user.email}</span>
                      <Badge className={`text-[10px] ${planColors[user.plan] || planColors.free}`}>{user.plan}</Badge>
                      {user.freetrial_used && user.plan !== 'freetrial' && <Badge className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/20">Trial used</Badge>}
                      {!user.email_confirmed && <Badge className="text-[10px] bg-orange-500/20 text-orange-400 border-orange-500/30">Unverified</Badge>}
                      {user.banned && <Badge className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">Banned</Badge>}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{formatRelativeTime(user.created_at)}</span>
                      {user.discord_username && <span>Discord: <span className="text-foreground">{user.discord_username}</span></span>}
                      {user.discord_id && <CopyButton text={user.discord_id} />}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    {user.discord_id && (
                      <Button variant="ghost" size="sm" onClick={() => handleOpenTicket(user, group)} className="h-7 w-7 p-0 text-blue-400 hover:bg-blue-500/10" title="Open abuse ticket">
                        <MessageSquarePlus className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {!user.banned && (
                      <Button variant="ghost" size="sm" onClick={() => openBanSingle(user)} className="h-7 w-7 p-0 text-red-400 hover:bg-red-500/10" title="Ban user">
                        <Ban className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openDelete(user)} className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10" title="Delete user">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {(group.fingerprints.length > 0 || group.ips.length > 0) && (
              <div className="border-t border-border/30 pt-3 space-y-2">
                {group.fingerprints.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Fingerprint className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex flex-wrap gap-1.5">
                      {group.fingerprints.map((fp) => (
                        <code key={fp} className="text-[10px] font-mono bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">{fp}</code>
                      ))}
                    </div>
                  </div>
                )}
                {group.ips.length > 0 && (
                  <div className="flex items-start gap-2">
                    <Globe className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="flex flex-wrap gap-1.5">
                      {group.ips.map((ip) => (
                        <span key={ip.ip} className="text-[10px] font-mono bg-muted/50 px-1.5 py-0.5 rounded text-muted-foreground">
                          {ip.ip}{ip.country_code ? ` (${ip.country_code})` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notes section */}
            <NotesSection
              notes={group.notes || []}
              caseId={group.id}
              currentUserId={userId}
              onAddNote={handleAddNote}
              onDeleteNote={handleDeleteNote}
            />
          </CardContent>
        </Card>
      ))}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <Card className="border-border/50 bg-card/50">
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <ShieldAlert className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">{statusFilter === 'all' ? 'No abuse cases found. Click "Scan Abuse" to detect.' : `No ${statusFilter} cases`}</p>
          </CardContent>
        </Card>
      )}

      {/* Ban Dialog */}
      <Dialog open={!!banTarget} onOpenChange={(open) => !open && setBanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-400">Ban User{banTarget && banTarget.users.length > 1 ? 's' : ''}</DialogTitle>
            <DialogDescription>
              Ban <strong>{banTarget?.label}</strong> from using Chessr. They will be disconnected and unable to log in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason template</label>
              <div className="flex flex-wrap gap-2">
                {BAN_TEMPLATES.map((t) => (
                  <Button key={t} variant="outline" size="sm" onClick={() => setBanReason(t)}
                    className={`text-xs ${banReason === t ? 'border-red-500/50 bg-red-500/10 text-red-400' : ''}`}>{t}</Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Custom reason</label>
              <Input placeholder="Enter ban reason..." value={banReason} onChange={(e) => setBanReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanTarget(null)} disabled={banning}>Cancel</Button>
            <Button variant="destructive" onClick={confirmBan} disabled={banning}>
              {banning ? <><Loader2 className="w-4 h-4 animate-spin" /> Banning...</> : <><Ban className="w-4 h-4 mr-1" /> Ban {banTarget && banTarget.users.length > 1 ? `${banTarget.users.length} users` : 'user'}</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeletePassword(''); setDeleteError('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete User</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deleteTarget?.email}</strong> and all associated data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Enter your password to confirm</label>
              <Input type="password" placeholder="Your admin password" value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirmDelete()} />
              {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting || !deletePassword}>
              {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</> : <><Trash2 className="w-4 h-4 mr-1" /> Delete permanently</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
