'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Unlink,
  Clock,
  Trash2,
  ShieldCheck,
  ShieldX,
  Ban,
  ShieldOff,
} from 'lucide-react'
import {
  type AdminUser,
  type UserRole,
  type UserPlan,
  canModifyRoles,
  canModifyPlans,
  planLabels,
  roleLabels,
  planColors,
  roleColors,
} from '@/lib/types'

interface UsersPanelProps {
  userRole: UserRole
  userId: string
  userEmail: string
}

interface LinkedAccount {
  id: string
  platform: string
  platform_username: string
  avatar_url?: string
  rating_bullet?: number
  rating_blitz?: number
  rating_rapid?: number
  linked_at: string
  unlinked_at?: string
  hasCooldown?: boolean
  hoursRemaining?: number
}

interface LinkedAccountsData {
  active: LinkedAccount[]
  unlinked: LinkedAccount[]
  totalActive: number
  totalUnlinked: number
}

type SortField = 'created_at' | 'plan_expiry' | 'last_activity'
type SortOrder = 'asc' | 'desc'

interface PlanStats {
  total: number
  free: number
  freetrial: number
  premium: number
  beta: number
  lifetime: number
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

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(search)
    }, 300)
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [search])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        sortBy,
        sortOrder,
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (roleFilter && roleFilter !== 'all') params.set('role', roleFilter)
      if (planFilter && planFilter !== 'all') params.set('plan', planFilter)

      const response = await fetch(`/api/users?${params}`)
      const data = await response.json()

      setUsers(data.data || [])
      setTotalPages(data.totalPages || 1)
      setTotal(data.total || 0)
      if (data.stats) {
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, roleFilter, planFilter, sortBy, sortOrder])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, roleFilter, planFilter])

  const fetchLinkedAccounts = async (userId: string) => {
    setLoadingAccounts(true)
    try {
      const response = await fetch(`/api/linked-accounts?userId=${userId}`)
      const data = await response.json()
      setLinkedAccounts(data)
    } catch (error) {
      console.error('Failed to fetch linked accounts:', error)
      setLinkedAccounts(null)
    } finally {
      setLoadingAccounts(false)
    }
  }

  const removeCooldown = async (accountId: string) => {
    setRemovingCooldown(accountId)
    try {
      const response = await fetch('/api/linked-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })

      if (!response.ok) {
        throw new Error('Failed to remove cooldown')
      }

      // Refresh linked accounts
      if (editUser) {
        await fetchLinkedAccounts(editUser.user_id)
      }
    } catch (error) {
      console.error('Failed to remove cooldown:', error)
      alert('Failed to remove cooldown')
    } finally {
      setRemovingCooldown(null)
    }
  }

  const unlinkAccount = async (accountId: string) => {
    if (!confirm('Are you sure you want to unlink this account?')) return

    setUnlinkingAccount(accountId)
    try {
      const response = await fetch('/api/linked-accounts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })

      if (!response.ok) {
        throw new Error('Failed to unlink account')
      }

      // Refresh linked accounts and user list
      if (editUser) {
        await fetchLinkedAccounts(editUser.user_id)
        await fetchUsers()
      }
    } catch (error) {
      console.error('Failed to unlink account:', error)
      alert('Failed to unlink account')
    } finally {
      setUnlinkingAccount(null)
    }
  }

  const openEditDialog = (user: AdminUser) => {
    setEditUser(user)
    setEditPlan(user.plan)
    setEditRole(user.role)
    setEditExpiry(user.plan_expiry ? user.plan_expiry.split('T')[0] : '')
    setLinkedAccounts(null)
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

    // Validate expiry is required for freetrial and premium
    if ((editPlan === 'freetrial' || editPlan === 'premium') && !editExpiry) {
      alert('Expiry date is required for Free Trial and Premium plans')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        userId: editUser.user_id,
        callerRole: userRole,
        adminUserId: userId,
        adminEmail: userEmail,
        userEmail: editUser.email,
      }

      if (editPlan !== editUser.plan) body.plan = editPlan
      if (canModifyRoles(userRole) && editRole !== editUser.role) body.role = editRole
      if (editExpiry !== (editUser.plan_expiry?.split('T')[0] || '')) {
        body.planExpiry = editExpiry ? new Date(editExpiry).toISOString() : null
      }

      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update user')
      }

      await fetchUsers()
      closeEditDialog()
    } catch (error) {
      console.error('Failed to save user:', error)
      alert(error instanceof Error ? error.message : 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const openDeleteDialog = (user: AdminUser) => {
    setDeleteUser(user)
    setDeletePassword('')
    setDeleteError('')
  }

  const closeDeleteDialog = () => {
    setDeleteUser(null)
    setDeletePassword('')
    setDeleteError('')
  }

  const confirmDelete = async () => {
    if (!deleteUser || !deletePassword) return

    setDeleting(true)
    setDeleteError('')
    try {
      const response = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: deleteUser.user_id,
          adminEmail: userEmail,
          adminPassword: deletePassword,
          callerRole: userRole,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setDeleteError(data.error || 'Failed to delete user')
        return
      }

      closeDeleteDialog()
      closeEditDialog()
      await fetchUsers()
    } catch {
      setDeleteError('Network error')
    } finally {
      setDeleting(false)
    }
  }

  const BAN_TEMPLATES = [
    'Disposable email usage',
    'Terms of Service violation',
    'Inappropriate behavior',
    'Suspicious activity',
  ]

  const openBanDialog = (user: AdminUser) => {
    setBanUser(user)
    setBanReason('')
  }

  const closeBanDialog = () => {
    setBanUser(null)
    setBanReason('')
  }

  const confirmBan = async () => {
    if (!banUser) return

    setBanning(true)
    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: banUser.user_id,
          callerRole: userRole,
          adminUserId: userId,
          adminEmail: userEmail,
          userEmail: banUser.email,
          banned: true,
          banReason: banReason || 'Banned by admin',
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to ban user')
      }

      closeBanDialog()
      closeEditDialog()
      await fetchUsers()
    } catch (error) {
      console.error('Failed to ban user:', error)
      alert(error instanceof Error ? error.message : 'Failed to ban user')
    } finally {
      setBanning(false)
    }
  }

  const unbanUser = async (user: AdminUser) => {
    setSaving(true)
    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.user_id,
          callerRole: userRole,
          adminUserId: userId,
          adminEmail: userEmail,
          userEmail: user.email,
          banned: false,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to unban user')
      }

      closeEditDialog()
      await fetchUsers()
    } catch (error) {
      console.error('Failed to unban user:', error)
      alert(error instanceof Error ? error.message : 'Failed to unban user')
    } finally {
      setSaving(false)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatRelativeTime = (dateString: string | null) => {
    if (!dateString) return 'Never'
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
    return formatDate(dateString)
  }

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
    setPage(1)
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return null
    return sortOrder === 'asc' ? (
      <ChevronUp className="w-3 h-3 ml-1" />
    ) : (
      <ChevronDown className="w-3 h-3 ml-1" />
    )
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/10">
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-zinc-500/10">
                <Users className="w-4 h-4 text-zinc-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.free}</p>
                <p className="text-xs text-muted-foreground">Free</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-sky-500/10">
                <Users className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.freetrial}</p>
                <p className="text-xs text-muted-foreground">Trial</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <Crown className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.premium}</p>
                <p className="text-xs text-muted-foreground">Premium</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/10">
                <Users className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.beta}</p>
                <p className="text-xs text-muted-foreground">Beta</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50 bg-card/50 backdrop-blur">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/10">
                <Crown className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold">{stats.lifetime}</p>
                <p className="text-xs text-muted-foreground">Lifetime</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
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
              <Input
                placeholder="Search by email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="user">User</SelectItem>
              </SelectContent>
            </Select>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-full sm:w-[150px]">
                <SelectValue placeholder="All plans" />
              </SelectTrigger>
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

          {/* Users table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border/50">
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    Email
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    Role
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                    Plan
                  </th>
                  <th className="text-center py-3 px-2 text-sm font-medium text-muted-foreground">
                    <Link2 className="w-4 h-4 mx-auto" />
                  </th>
                  <th
                    className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden md:table-cell cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('plan_expiry')}
                  >
                    <span className="flex items-center">
                      Expiry
                      <SortIcon field="plan_expiry" />
                    </span>
                  </th>
                  <th
                    className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden lg:table-cell cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('created_at')}
                  >
                    <span className="flex items-center">
                      Created
                      <SortIcon field="created_at" />
                    </span>
                  </th>
                  <th
                    className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden xl:table-cell cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => toggleSort('last_activity')}
                  >
                    <span className="flex items-center">
                      Last Activity
                      <SortIcon field="last_activity" />
                    </span>
                  </th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.user_id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1.5">
                          {user.email_confirmed ? (
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" title="Email verified" />
                          ) : (
                            <ShieldX className="w-3.5 h-3.5 text-red-400 shrink-0" title="Email not verified" />
                          )}
                          <span className="text-sm truncate max-w-[200px] block">{user.email}</span>
                          {user.banned && (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 ml-1.5 text-[10px] px-1 py-0">
                              Banned
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <Badge className={roleColors[user.role]}>{roleLabels[user.role]}</Badge>
                      </td>
                      <td className="py-3 px-2">
                        <Badge className={planColors[user.plan]}>{planLabels[user.plan]}</Badge>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className={`text-sm ${user.linked_count > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                          {user.linked_count}
                        </span>
                      </td>
                      <td className="py-3 px-2 hidden md:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {formatDate(user.plan_expiry)}
                        </span>
                      </td>
                      <td className="py-3 px-2 hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {formatDate(user.created_at)}
                        </span>
                      </td>
                      <td className="py-3 px-2 hidden xl:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {formatRelativeTime(user.last_activity)}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(user)}
                          disabled={user.user_id === userId}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
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
              Page {page} of {totalPages} ({total} users)
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

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Role selector (super_admin only) */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              {canModifyRoles(userRole) ? (
                <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center h-9">
                  <Badge className={roleColors[editRole]}>{roleLabels[editRole]}</Badge>
                  <span className="ml-2 text-xs text-muted-foreground">
                    (Only Super Admins can modify roles)
                  </span>
                </div>
              )}
            </div>

            {/* Plan selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Plan</label>
              {canModifyPlans(userRole) ? (
                <Select value={editPlan} onValueChange={(v) => setEditPlan(v as UserPlan)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">Free</SelectItem>
                    <SelectItem value="freetrial">Free Trial</SelectItem>
                    <SelectItem value="premium">Premium</SelectItem>
                    <SelectItem value="beta">Beta</SelectItem>
                    <SelectItem value="lifetime">Lifetime</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Badge className={planColors[editPlan]}>{planLabels[editPlan]}</Badge>
              )}
            </div>

            {/* Expiry date (for freetrial and premium) */}
            {(editPlan === 'freetrial' || editPlan === 'premium') && canModifyPlans(userRole) && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Plan Expiry</label>
                <Input
                  type="date"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                />
              </div>
            )}

            {/* Linked Accounts Section */}
            <div className="space-y-3 pt-4 border-t border-border/50">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Link2 className="w-4 h-4" />
                  Linked Accounts
                </label>
                {linkedAccounts && (
                  <Badge variant="outline" className="text-xs">
                    {linkedAccounts.totalActive} active
                  </Badge>
                )}
              </div>

              {loadingAccounts ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : linkedAccounts ? (
                <div className="space-y-3">
                  {/* Active accounts */}
                  {linkedAccounts.active.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Active</p>
                      {linkedAccounts.active.map((account) => (
                        <div
                          key={account.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                        >
                          <div className="flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium">{account.platform_username}</span>
                            <Badge variant="outline" className="text-xs">
                              {account.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {account.rating_blitz && `${account.rating_blitz} blitz`}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => unlinkAccount(account.id)}
                              disabled={unlinkingAccount === account.id}
                              className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              {unlinkingAccount === account.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Unlink className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Unlinked accounts with cooldown */}
                  {linkedAccounts.unlinked.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Unlinked (with cooldown)</p>
                      {linkedAccounts.unlinked.map((account) => (
                        <div
                          key={account.id}
                          className={`flex items-center justify-between p-2 rounded-lg ${
                            account.hasCooldown
                              ? 'bg-amber-500/10 border border-amber-500/20'
                              : 'bg-muted/30 border border-border/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Unlink className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm">{account.platform_username}</span>
                            <Badge variant="outline" className="text-xs">
                              {account.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}
                            </Badge>
                            {account.hasCooldown && (
                              <span className="text-xs text-amber-400 flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {account.hoursRemaining}h
                              </span>
                            )}
                          </div>
                          {account.hasCooldown && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCooldown(account.id)}
                              disabled={removingCooldown === account.id}
                              className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                            >
                              {removingCooldown === account.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <>
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  Remove cooldown
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {linkedAccounts.active.length === 0 && linkedAccounts.unlinked.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      No linked accounts
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Failed to load accounts
                </p>
              )}
            </div>
          </div>

          {/* Ban status indicator */}
          {editUser?.banned && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
                <Ban className="w-4 h-4" />
                Banned
              </div>
              {editUser.ban_reason && (
                <p className="text-xs text-muted-foreground mt-1">{editUser.ban_reason}</p>
              )}
              {editUser.banned_by && editUser.banned_at && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  by {editUser.banned_by} on {formatDate(editUser.banned_at)}
                </p>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2 sm:mr-auto">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => editUser && openDeleteDialog(editUser)}
                disabled={saving}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
              {editUser?.banned ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => editUser && unbanUser(editUser)}
                  disabled={saving}
                  className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                >
                  <ShieldOff className="w-4 h-4 mr-1" />
                  Unban
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => editUser && openBanDialog(editUser)}
                  disabled={saving}
                  className="text-red-400 border-red-500/30 hover:bg-red-500/10"
                >
                  <Ban className="w-4 h-4 mr-1" />
                  Ban
                </Button>
              )}
            </div>
            <Button variant="outline" onClick={closeEditDialog} disabled={saving}>
              Cancel
            </Button>
            <Button variant="gradient" onClick={saveUser} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteUser} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete User</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deleteUser?.email}</strong> and all associated data
              (settings, activity, linked accounts, IPs). This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Enter your password to confirm</label>
              <Input
                type="password"
                placeholder="Your admin password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmDelete()}
              />
              {deleteError && (
                <p className="text-sm text-red-400">{deleteError}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteDialog} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting || !deletePassword}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete permanently
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ban Confirmation Dialog */}
      <Dialog open={!!banUser} onOpenChange={(open) => !open && closeBanDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-400">Ban User</DialogTitle>
            <DialogDescription>
              Ban <strong>{banUser?.email}</strong> from using Chessr. They will be disconnected and unable to log in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason template</label>
              <div className="flex flex-wrap gap-2">
                {BAN_TEMPLATES.map((template) => (
                  <Button
                    key={template}
                    variant="outline"
                    size="sm"
                    onClick={() => setBanReason(template)}
                    className={`text-xs ${banReason === template ? 'border-red-500/50 bg-red-500/10 text-red-400' : ''}`}
                  >
                    {template}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Custom reason</label>
              <Input
                placeholder="Enter ban reason..."
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeBanDialog} disabled={banning}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmBan}
              disabled={banning}
            >
              {banning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Banning...
                </>
              ) : (
                <>
                  <Ban className="w-4 h-4 mr-1" />
                  Ban user
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
