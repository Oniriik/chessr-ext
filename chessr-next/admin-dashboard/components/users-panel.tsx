'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Pencil,
  Loader2,
  Users,
  Crown,
  Link2,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import {
  type UserRole,
  type UserPlan,
  canModifyRoles,
  planLabels,
  roleLabels,
  planColors,
  roleColors,
} from '@/lib/types'
import { formatDate, formatRelativeTime } from '@/lib/format'
import type { AdminUser, LinkedAccountsData, SortField, SortOrder, PlanStats } from './users/user-types'
import { UserEditDialog } from './users/user-edit-dialog'
import { UserBanDialog } from './users/user-ban-dialog'
import { UserDeleteDialog } from './users/user-delete-dialog'

interface UsersPanelProps {
  userRole: UserRole
  userId: string
  userEmail: string
}

export function UsersPanel({ userRole, userId, userEmail }: UsersPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<PlanStats>({ total: 0, free: 0, freetrial: 0, premium: 0, beta: 0, lifetime: 0 })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [planFilter, setPlanFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Edit dialog state
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editPlan, setEditPlan] = useState<UserPlan>('free')
  const [editRole, setEditRole] = useState<UserRole>('user')
  const [editExpiry, setEditExpiry] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Delete dialog state
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // Ban dialog state
  const [banUser, setBanUser] = useState<AdminUser | null>(null)
  const [banReason, setBanReason] = useState('')
  const [banning, setBanning] = useState(false)

  // Linked accounts state
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountsData | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [removingCooldown, setRemovingCooldown] = useState<string | null>(null)
  const [unlinkingAccount, setUnlinkingAccount] = useState<string | null>(null)
  const [unlinkingDiscord, setUnlinkingDiscord] = useState(false)
  const [resyncingDiscord, setResyncingDiscord] = useState(false)
  const [resyncResult, setResyncResult] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current) }
  }, [search])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '20', sortBy, sortOrder })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (roleFilter && roleFilter !== 'all') params.set('role', roleFilter)
      if (planFilter && planFilter !== 'all') params.set('plan', planFilter)

      const response = await fetch(`/api/users?${params}`)
      const data = await response.json()
      setUsers(data.data || [])
      setTotalPages(data.totalPages || 1)
      setTotal(data.total || 0)
      if (data.stats) setStats(data.stats)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, roleFilter, planFilter, sortBy, sortOrder])

  useEffect(() => { fetchUsers() }, [fetchUsers])
  useEffect(() => { setPage(1) }, [debouncedSearch, roleFilter, planFilter])

  // ---- Linked accounts handlers ----

  const fetchLinkedAccounts = async (uid: string) => {
    setLoadingAccounts(true)
    try {
      const response = await fetch(`/api/linked-accounts?userId=${uid}`)
      setLinkedAccounts(await response.json())
    } catch { setLinkedAccounts(null) }
    finally { setLoadingAccounts(false) }
  }

  const removeCooldown = async (accountId: string) => {
    setRemovingCooldown(accountId)
    try {
      const res = await fetch('/api/linked-accounts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }) })
      if (!res.ok) throw new Error()
      if (editUser) await fetchLinkedAccounts(editUser.user_id)
    } catch { toast.error('Failed to remove cooldown') }
    finally { setRemovingCooldown(null) }
  }

  const unlinkAccount = async (accountId: string) => {
    if (!confirm('Are you sure you want to unlink this account?')) return
    setUnlinkingAccount(accountId)
    try {
      const res = await fetch('/api/linked-accounts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId }) })
      if (!res.ok) throw new Error()
      if (editUser) { await fetchLinkedAccounts(editUser.user_id); await fetchUsers() }
    } catch { toast.error('Failed to unlink account') }
    finally { setUnlinkingAccount(null) }
  }

  const unlinkDiscord = async (targetUserId: string) => {
    if (!confirm('Are you sure you want to unlink this Discord account?')) return
    setUnlinkingDiscord(true)
    try {
      const res = await fetch('/api/linked-accounts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'discord', userId: targetUserId }) })
      if (!res.ok) throw new Error()
      if (editUser) await fetchLinkedAccounts(editUser.user_id)
    } catch { toast.error('Failed to unlink Discord') }
    finally { setUnlinkingDiscord(false) }
  }

  const resyncDiscord = async (targetUserId: string) => {
    setResyncingDiscord(true)
    setResyncResult(null)
    try {
      const res = await fetch('/api/users/resync-discord', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: targetUserId }) })
      const data = await res.json()
      if (!res.ok) { setResyncResult(`Error: ${data.error}`); return }
      setResyncResult(data.message + (data.elo ? ` | ELO: ${data.elo}` : '') + ` | Plan: ${data.plan}`)
    } catch { setResyncResult('Network error') }
    finally { setResyncingDiscord(false) }
  }

  // ---- Edit dialog handlers ----

  const openEditDialog = (user: AdminUser) => {
    setEditUser(user)
    setEditPlan(user.plan)
    setEditRole(user.role)
    setEditExpiry(user.plan_expiry ? user.plan_expiry.split('T')[0] : '')
    setLinkedAccounts(null)
    setResyncResult(null)
    fetchLinkedAccounts(user.user_id)
  }

  const closeEditDialog = () => {
    setEditUser(null)
    setEditPlan('free')
    setEditRole('user')
    setEditExpiry('')
  }

  const saveUser = async () => {
    if (!editUser) return
    if ((editPlan === 'freetrial' || editPlan === 'premium') && !editExpiry) {
      toast.error('Expiry date is required for Free Trial and Premium plans')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        userId: editUser.user_id, callerRole: userRole,
        adminUserId: userId, adminEmail: userEmail, userEmail: editUser.email,
      }
      if (editPlan !== editUser.plan) body.plan = editPlan
      if (canModifyRoles(userRole) && editRole !== editUser.role) body.role = editRole
      if (editExpiry !== (editUser.plan_expiry?.split('T')[0] || '')) {
        body.planExpiry = editExpiry ? new Date(editExpiry).toISOString() : null
      }
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to update user') }
      await fetchUsers()
      closeEditDialog()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save user')
    } finally { setSaving(false) }
  }

  // ---- Delete dialog handlers ----

  const openDeleteDialog = (user: AdminUser) => { setDeleteUser(user); setDeletePassword(''); setDeleteError('') }
  const closeDeleteDialog = () => { setDeleteUser(null); setDeletePassword(''); setDeleteError('') }

  const confirmDelete = async () => {
    if (!deleteUser || !deletePassword) return
    setDeleting(true); setDeleteError('')
    try {
      const res = await fetch('/api/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: deleteUser.user_id, adminEmail: userEmail, adminPassword: deletePassword, callerRole: userRole }) })
      const data = await res.json()
      if (!res.ok) { setDeleteError(data.error || 'Failed to delete user'); return }
      closeDeleteDialog(); closeEditDialog(); await fetchUsers()
    } catch { setDeleteError('Network error') }
    finally { setDeleting(false) }
  }

  // ---- Ban dialog handlers ----

  const openBanDialog = (user: AdminUser) => { setBanUser(user); setBanReason('') }
  const closeBanDialog = () => { setBanUser(null); setBanReason('') }

  const confirmBan = async () => {
    if (!banUser) return
    setBanning(true)
    try {
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: banUser.user_id, callerRole: userRole, adminUserId: userId, adminEmail: userEmail, userEmail: banUser.email, banned: true, banReason: banReason || 'Banned by admin' }) })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to ban user') }
      closeBanDialog(); closeEditDialog(); await fetchUsers()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to ban user') }
    finally { setBanning(false) }
  }

  const unbanUser = async (user: AdminUser) => {
    setSaving(true)
    try {
      const res = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user.user_id, callerRole: userRole, adminUserId: userId, adminEmail: userEmail, userEmail: user.email, banned: false }) })
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Failed to unban user') }
      closeEditDialog(); await fetchUsers()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to unban user') }
    finally { setSaving(false) }
  }

  // ---- Sort helpers ----

  const toggleSort = (field: SortField) => {
    if (sortBy === field) { setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc') }
    else { setSortBy(field); setSortOrder('desc') }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return null
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total', value: stats.total, icon: Users, bg: 'bg-blue-500/10', text: 'text-blue-400' },
          { label: 'Free', value: stats.free, icon: Users, bg: 'bg-zinc-500/10', text: 'text-zinc-400' },
          { label: 'Trial', value: stats.freetrial, icon: Users, bg: 'bg-sky-500/10', text: 'text-sky-400' },
          { label: 'Premium', value: stats.premium, icon: Crown, bg: 'bg-amber-500/10', text: 'text-amber-400' },
          { label: 'Beta', value: stats.beta, icon: Users, bg: 'bg-purple-500/10', text: 'text-purple-400' },
          { label: 'Lifetime', value: stats.lifetime, icon: Crown, bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
        ].map(({ label, value, icon: Icon, bg, text }) => (
          <Card key={label} className="border-border/50 bg-card/50 backdrop-blur">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${bg}`}>
                  <Icon className={`w-4 h-4 ${text}`} />
                </div>
                <div>
                  <p className="text-xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters & Table */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Users Management</CardTitle>
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search and filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search by email..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="All roles" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="All plans" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plans</SelectItem>
                <SelectItem value="free">Free</SelectItem>
                <SelectItem value="freetrial">Free Trial</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
                <SelectItem value="beta">Beta</SelectItem>
                <SelectItem value="lifetime">Lifetime</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Desktop table */}
          <div className="overflow-x-auto hidden sm:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Email</th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Role</th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Plan</th>
                  <th className="text-center py-3 px-2 text-sm font-medium text-muted-foreground"><Link2 className="w-4 h-4 mx-auto" /></th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden md:table-cell cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort('plan_expiry')}>
                    <span className="flex items-center">Expiry<SortIcon field="plan_expiry" /></span>
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden lg:table-cell cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort('created_at')}>
                    <span className="flex items-center">Created<SortIcon field="created_at" /></span>
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden xl:table-cell cursor-pointer hover:text-foreground transition-colors" onClick={() => toggleSort('last_activity')}>
                    <span className="flex items-center">Last Activity<SortIcon field="last_activity" /></span>
                  </th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No users found</td></tr>
                ) : users.map((user) => (
                  <tr key={user.user_id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-1.5">
                        {user.email_confirmed ? (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <ShieldX className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="text-sm truncate max-w-[200px] block">{user.email}</span>
                        {user.banned && (
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 ml-1.5 text-[10px] px-1 py-0">Banned</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2"><Badge className={roleColors[user.role]}>{roleLabels[user.role]}</Badge></td>
                    <td className="py-3 px-2"><Badge className={planColors[user.plan]}>{planLabels[user.plan]}</Badge></td>
                    <td className="py-3 px-2 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`text-sm ${user.linked_count > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>{user.linked_count}</span>
                        {user.has_discord && (
                          <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                          </svg>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 hidden md:table-cell"><span className="text-sm text-muted-foreground">{formatDate(user.plan_expiry)}</span></td>
                    <td className="py-3 px-2 hidden lg:table-cell"><span className="text-sm text-muted-foreground">{formatDate(user.created_at)}</span></td>
                    <td className="py-3 px-2 hidden xl:table-cell"><span className="text-sm text-muted-foreground">{formatRelativeTime(user.last_activity)}</span></td>
                    <td className="py-3 px-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => openEditDialog(user)} disabled={user.user_id === userId && userRole !== 'super_admin'}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="sm:hidden space-y-2">
            {loading ? (
              <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : users.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No users found</p>
            ) : users.map((user) => (
              <button
                key={user.user_id}
                onClick={() => openEditDialog(user)}
                disabled={user.user_id === userId && userRole !== 'super_admin'}
                className="w-full text-left p-3 rounded-lg border border-border/30 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-medium truncate max-w-[200px]">{user.email}</span>
                  {user.banned && (
                    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1 py-0">Banned</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className={`${roleColors[user.role]} text-[10px]`}>{roleLabels[user.role]}</Badge>
                  <Badge className={`${planColors[user.plan]} text-[10px]`}>{planLabels[user.plan]}</Badge>
                  {user.linked_count > 0 && (
                    <span className="text-[10px] text-emerald-400">{user.linked_count} linked</span>
                  )}
                  {user.has_discord && (
                    <svg className="w-3 h-3 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                    </svg>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">{formatRelativeTime(user.last_activity)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-4">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages} ({total} users)
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <UserEditDialog
        editUser={editUser}
        editPlan={editPlan}
        editRole={editRole}
        editExpiry={editExpiry}
        saving={saving}
        userRole={userRole}
        linkedAccounts={linkedAccounts}
        loadingAccounts={loadingAccounts}
        unlinkingAccount={unlinkingAccount}
        unlinkingDiscord={unlinkingDiscord}
        resyncingDiscord={resyncingDiscord}
        resyncResult={resyncResult}
        removingCooldown={removingCooldown}
        onClose={closeEditDialog}
        onSave={saveUser}
        onSetEditPlan={setEditPlan}
        onSetEditRole={setEditRole}
        onSetEditExpiry={setEditExpiry}
        onUnlinkAccount={unlinkAccount}
        onUnlinkDiscord={unlinkDiscord}
        onResyncDiscord={resyncDiscord}
        onRemoveCooldown={removeCooldown}
        onOpenDeleteDialog={openDeleteDialog}
        onOpenBanDialog={openBanDialog}
        onUnbanUser={unbanUser}
      />

      <UserDeleteDialog
        deleteUser={deleteUser}
        deletePassword={deletePassword}
        deleting={deleting}
        deleteError={deleteError}
        onClose={closeDeleteDialog}
        onConfirm={confirmDelete}
        onSetDeletePassword={setDeletePassword}
      />

      <UserBanDialog
        banUser={banUser}
        banReason={banReason}
        banning={banning}
        onClose={closeBanDialog}
        onConfirm={confirmBan}
        onSetBanReason={setBanReason}
      />
    </div>
  )
}
