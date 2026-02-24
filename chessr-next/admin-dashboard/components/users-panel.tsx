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
  Pencil,
  Loader2,
  Users,
  Crown,
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
}

export function UsersPanel({ userRole, userId }: UsersPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [planFilter, setPlanFilter] = useState<string>('all')

  // Edit dialog state
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editPlan, setEditPlan] = useState<UserPlan>('free')
  const [editRole, setEditRole] = useState<UserRole>('user')
  const [editExpiry, setEditExpiry] = useState<string>('')
  const [saving, setSaving] = useState(false)

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

  const openEditDialog = (user: AdminUser) => {
    setEditUser(user)
    setEditPlan(user.plan)
    setEditRole(user.role)
    setEditExpiry(user.plan_expiry ? user.plan_expiry.split('T')[0] : '')
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
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden md:table-cell">
                    Expiry
                  </th>
                  <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground hidden lg:table-cell">
                    Created
                  </th>
                  <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                    Actions
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
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
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
