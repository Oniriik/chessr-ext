'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LivePanel } from '@/components/live-panel'
import { LogsPanel } from '@/components/logs-panel'
import { UsersPanel } from '@/components/users-panel'
import { ServerPanel } from '@/components/server-panel'
import { PlansPanel } from '@/components/plans-panel'
import { DiscordPanel } from '@/components/discord-panel'
import { DataPanel } from '@/components/data-panel'
import { LeaderboardPanel } from '@/components/leaderboard-panel'
import { type UserRole, roleLabels, roleColors } from '@/lib/types'
import {
  LogOut,
  Activity,
  BarChart3,
  ScrollText,
  Users,
  Server,
  Loader2,
  Gift,
  MessageSquare,
  Trophy,
  Menu,
  X,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'

type TabId = 'live' | 'data' | 'server' | 'logs' | 'users' | 'plans' | 'discord' | 'leaderboard'

interface NavItem {
  id: TabId
  label: string
  icon: React.ElementType
  group: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'live', label: 'Live', icon: Activity, group: 'Monitor' },
  { id: 'data', label: 'Data', icon: BarChart3, group: 'Monitor' },
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, group: 'Monitor' },
  { id: 'server', label: 'Server', icon: Server, group: 'Manage' },
  { id: 'logs', label: 'Logs', icon: ScrollText, group: 'Manage' },
  { id: 'users', label: 'Users', icon: Users, group: 'Users' },
  { id: 'plans', label: 'Activity', icon: Gift, group: 'Users' },
  { id: 'discord', label: 'Discord', icon: MessageSquare, group: 'Communicate' },
]

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('user')
  const [userId, setUserId] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('live')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push('/login')
        return
      }

      setUserEmail(user.email || '')
      setUserId(user.id)

      const response = await fetch('/api/auth/check-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      })

      const data = await response.json()

      if (!response.ok || !data.canAccess) {
        await supabase.auth.signOut()
        router.push('/login')
        return
      }

      setUserRole(data.role)
    } catch (error) {
      console.error('Auth check error:', error)
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  const renderPanel = () => {
    switch (activeTab) {
      case 'live': return <LivePanel />
      case 'data': return <DataPanel />
      case 'server': return <ServerPanel />
      case 'logs': return <LogsPanel />
      case 'users': return <UsersPanel userRole={userRole} userId={userId} userEmail={userEmail} />
      case 'plans': return <PlansPanel />
      case 'leaderboard': return <LeaderboardPanel />
      case 'discord': return <DiscordPanel />
    }
  }

  // Group nav items for sidebar
  const groups = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {})

  return (
    <div className="min-h-screen">
      {/* Background effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Logo + nav toggles */}
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden h-8 w-8"
              >
                {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
              </Button>
              {/* Desktop sidebar toggle */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="hidden md:flex h-8 w-8"
              >
                {sidebarCollapsed ? (
                  <PanelLeft className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </Button>
              <img src="https://chessr.io/chessr-logo.png" alt="Chessr" className="w-8 h-8" />
              <div className="hidden sm:block">
                <h1 className="text-lg font-bold leading-tight">
                  <span className="text-white">chessr</span>
                  <span className="gradient-text">.io</span>
                </h1>
                <p className="text-[10px] text-muted-foreground leading-none">Admin Dashboard</p>
              </div>
            </div>

            {/* User info */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                <span className="text-sm text-foreground">{userEmail}</span>
                <Badge className={roleColors[userRole]}>{roleLabels[userRole]}</Badge>
              </div>
              <Button variant="ghost" size="icon" onClick={handleSignOut} className="h-8 w-8">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex relative z-10">
        {/* Desktop Sidebar */}
        <aside
          className={`hidden md:flex flex-col shrink-0 sticky top-[57px] h-[calc(100vh-57px)] border-r border-border/50 bg-background/50 backdrop-blur-sm transition-all duration-200 ${
            sidebarCollapsed ? 'w-14' : 'w-48'
          }`}
        >
          <nav className="flex-1 py-3 px-2 space-y-4 overflow-y-auto">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                {!sidebarCollapsed && (
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                    {group}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon
                    const isActive = activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors ${
                          sidebarCollapsed ? 'justify-center px-2 py-2' : 'px-2.5 py-1.5'
                        } ${
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                        title={sidebarCollapsed ? item.label : undefined}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {!sidebarCollapsed && <span>{item.label}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-4 py-6">
          {renderPanel()}
        </main>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="md:hidden fixed top-[57px] left-0 bottom-0 z-50 w-56 border-r border-border/50 bg-background/95 backdrop-blur-xl overflow-y-auto">
            <nav className="py-3 px-2 space-y-4">
              {Object.entries(groups).map(([group, items]) => (
                <div key={group}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                    {group}
                  </p>
                  <div className="space-y-0.5">
                    {items.map((item) => {
                      const Icon = item.icon
                      const isActive = activeTab === item.id
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setActiveTab(item.id); setMobileMenuOpen(false) }}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span>{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </aside>
        </>
      )}
    </div>
  )
}
