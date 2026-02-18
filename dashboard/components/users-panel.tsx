'use client'

import { useEffect, useState } from 'react'
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
import { Users, Search, RefreshCw, Pencil, Crown, Hammer, Clock, Lock } from 'lucide-react'

interface User {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  plan: 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime'
  plan_expiry: string | null
}

type Plan = 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime'

const planConfig: Record<Plan, { label: string; color: string; icon: typeof Crown }> = {
  lifetime: { label: 'Lifetime', color: 'bg-purple-500', icon: Crown },
  beta: { label: 'Beta', color: 'bg-indigo-500', icon: Hammer },
  premium: { label: 'Premium', color: 'bg-blue-500', icon: Crown },
  freetrial: { label: 'Free Trial', color: 'bg-orange-500', icon: Clock },
  free: { label: 'Free', color: 'bg-gray-500', icon: Lock },
}

export default function UsersPanel() {
  const [users, setUsers] = useState<User[]>([])
  const [filteredUsers, setFilteredUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [planFilter, setPlanFilter] = useState<string>('all')

  // Edit modal state
  const [editUser, setEditUser] = useState<User | null>(null)
  const [editPlan, setEditPlan] = useState<Plan>('free')
  const [editExpiry, setEditExpiry] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchUsers()
  }, [])

  useEffect(() => {
    filterUsers()
  }, [users, searchQuery, planFilter])

  async function fetchUsers() {
    setLoading(true)
    try {
      const response = await fetch('/api/users')
      const data = await response.json()
      if (data.users) {
        setUsers(data.users)
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    }
    setLoading(false)
  }

  function filterUsers() {
    let filtered = [...users]

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter((user) =>
        user.email?.toLowerCase().includes(query)
      )
    }

    // Filter by plan
    if (planFilter !== 'all') {
      filtered = filtered.filter((user) => user.plan === planFilter)
    }

    setFilteredUsers(filtered)
  }

  function openEditModal(user: User) {
    setEditUser(user)
    setEditPlan(user.plan)
    setEditExpiry(user.plan_expiry ? user.plan_expiry.split('T')[0] : '')
  }

  function closeEditModal() {
    setEditUser(null)
    setEditPlan('free')
    setEditExpiry('')
  }

  async function saveUser() {
    if (!editUser) return

    setSaving(true)
    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editUser.id,
          plan: editPlan,
          planExpiry: ['freetrial', 'premium'].includes(editPlan) && editExpiry
            ? new Date(editExpiry).toISOString()
            : null,
        }),
      })

      if (response.ok) {
        // Update local state
        setUsers((prev) =>
          prev.map((u) =>
            u.id === editUser.id
              ? {
                  ...u,
                  plan: editPlan,
                  plan_expiry: ['freetrial', 'premium'].includes(editPlan) && editExpiry
                    ? new Date(editExpiry).toISOString()
                    : null,
                }
              : u
          )
        )
        closeEditModal()
      } else {
        console.error('Failed to save user')
      }
    } catch (error) {
      console.error('Error saving user:', error)
    }
    setSaving(false)
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function getExpiryStatus(expiry: string | null, plan: Plan) {
    if (!expiry || !['freetrial', 'premium'].includes(plan)) return null
    const expiryDate = new Date(expiry)
    const now = new Date()
    const diffDays = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays < 0) return { text: 'Expired', color: 'text-red-500' }
    if (diffDays === 0) return { text: 'Today', color: 'text-yellow-500' }
    if (diffDays <= 3) return { text: `${diffDays}d left`, color: 'text-yellow-500' }
    return { text: `${diffDays}d left`, color: 'text-muted-foreground' }
  }

  // Plan stats
  const planStats = users.reduce(
    (acc, user) => {
      acc[user.plan] = (acc[user.plan] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Users ({users.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stats */}
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.entries(planConfig).map(([plan, config]) => (
              <Badge key={plan} variant="outline" className="gap-1">
                <config.icon className="w-3 h-3" />
                {config.label}: {planStats[plan] || 0}
              </Badge>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={planFilter} onValueChange={setPlanFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plans</SelectItem>
                {Object.entries(planConfig).map(([plan, config]) => (
                  <SelectItem key={plan} value={plan}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium">Email</th>
                  <th className="text-left p-3 font-medium">Plan</th>
                  <th className="text-left p-3 font-medium">Expiry</th>
                  <th className="text-left p-3 font-medium">Created</th>
                  <th className="text-left p-3 font-medium">Last Sign In</th>
                  <th className="text-right p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-muted-foreground">
                      Loading users...
                    </td>
                  </tr>
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center p-8 text-muted-foreground">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const config = planConfig[user.plan]
                    const expiryStatus = getExpiryStatus(user.plan_expiry, user.plan)
                    return (
                      <tr key={user.id} className="border-b hover:bg-muted/30">
                        <td className="p-3">
                          <span className="font-mono text-sm">{user.email}</span>
                        </td>
                        <td className="p-3">
                          <Badge className={`${config.color} text-white gap-1`}>
                            <config.icon className="w-3 h-3" />
                            {config.label}
                          </Badge>
                        </td>
                        <td className="p-3">
                          {expiryStatus ? (
                            <span className={expiryStatus.color}>
                              {formatDate(user.plan_expiry)} ({expiryStatus.text})
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">
                          {formatDate(user.last_sign_in_at)}
                        </td>
                        <td className="p-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditModal(user)}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Modal */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && closeEditModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Plan</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Plan</label>
              <Select value={editPlan} onValueChange={(v) => setEditPlan(v as Plan)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(planConfig).map(([plan, config]) => (
                    <SelectItem key={plan} value={plan}>
                      <div className="flex items-center gap-2">
                        <config.icon className="w-4 h-4" />
                        {config.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {['freetrial', 'premium'].includes(editPlan) && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Expiry Date</label>
                <Input
                  type="date"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
                <p className="text-xs text-muted-foreground">
                  The plan will automatically expire on this date
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditModal}>
              Cancel
            </Button>
            <Button onClick={saveUser} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
