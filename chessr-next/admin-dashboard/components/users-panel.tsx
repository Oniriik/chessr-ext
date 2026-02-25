'use client'

import { useEffect, useState, useCallback } from 'react'
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

export function UsersPanel({ userRole, userId, userEmail }: UsersPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [planFilter, setPlanFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<SortField>('created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // Edit dialog state
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editPlan, setEditPlan] = useState<UserPlan>('free')
  const [editRole, setEditRole] = useState<UserRole>('user')
  const [editExpiry, setEditExpiry] = useState<string>('')
  const [saving, setSaving] = useState(false)

  // Linked accounts state
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccountsData | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [removingCooldown, setRemovingCooldown] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
      })
      if (search.trim()) params.set('search', search.trim())
      if (roleFilter && roleFilter !== 'all') params.set('role', roleFilter)
      if (planFilter && planFilter !== 'all') params.set('plan', planFilter)

      const response = await fetch(`/api/users?${params}`)
      const data = await response.json()

      setUsers(data.data || [])
      setTotalPages(data.totalPages || 1)
      setTotal(data.total || 0)
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setLoading(false)
    }
  }, [page, search, roleFilter, planFilter])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    setPage(1)
  }, [search, roleFilter, planFilter])

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
  }

  const sortedUsers = [...users].sort((a, b) => {
    const aValue = a[sortBy]
    const bValue = b[sortBy]

    // Handle null values - put them at the end
    if (!aValue && !bValue) return 0
    if (!aValue) return 1
    if (!bValue) return -1

    const comparison = new Date(aValue).getTime() - new Date(bValue).getTime()
    return sortOrder === 'asc' ? comparison : -comparison
  })

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
                <p className="text-xl font-bold">{total}</p>
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
                <p className="text-xl font-bold">
                  {users.filter((u) => u.plan === 'free').length}
                </p>
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
                <p className="text-xl font-bold">
                  {users.filter((u) => u.plan === 'freetrial').length}
                </p>
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
                <p className="text-xl font-bold">
                  {users.filter((u) => u.plan === 'premium').length}
                </p>
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
                <p className="text-xl font-bold">
                  {users.filter((u) => u.plan === 'beta').length}
                </p>
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
                <p className="text-xl font-bold">
                  {users.filter((u) => u.plan === 'lifetime').length}
                </p>
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
                  sortedUsers.map((user) => (
                    <tr key={user.user_id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-3 px-2">
                        <span className="text-sm truncate max-w-[200px] block">{user.email}</span>
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
                          <div className="text-xs text-muted-foreground">
                            {account.rating_blitz && `${account.rating_blitz} blitz`}
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

          <DialogFooter>
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
    </div>
  )
}
