'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LivePanel } from '@/components/live-panel'
import { LogsPanel } from '@/components/logs-panel'
import { UsersPanel } from '@/components/users-panel'
import { ServerPanel } from '@/components/server-panel'
import { PlansPanel } from '@/components/plans-panel'
import { DiscordPanel } from '@/components/discord-panel'
import { type UserRole, roleLabels, roleColors } from '@/lib/types'
import { LogOut, Activity, ScrollText, Users, Server, Loader2, Gift, MessageSquare } from 'lucide-react'

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userEmail, setUserEmail] = useState('')
  const [userRole, setUserRole] = useState<UserRole>('user')
  const [userId, setUserId] = useState('')

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

      // Check role
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

  return (
    <div className="min-h-screen">
      {/* Background effects */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] bg-cyan-500/5 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <img src="https://chessr.io/chessr-logo.png" alt="Chessr" className="w-10 h-10" />
              <div>
                <h1 className="text-xl font-bold">
                  <span className="text-white">chessr</span>
                  <span className="gradient-text">.io</span>
                </h1>
                <p className="text-xs text-muted-foreground">Admin Dashboard</p>
              </div>
            </div>

            {/* User info */}
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-3">
                <span className="text-sm text-foreground">{userEmail}</span>
                <Badge className={roleColors[userRole]}>{roleLabels[userRole]}</Badge>
              </div>
              <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out">
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-4 py-6 relative z-10">
        <Tabs defaultValue="live" className="space-y-6">
          <TabsList className="grid w-full grid-cols-6 lg:w-auto lg:inline-flex">
            <TabsTrigger value="live" className="gap-2">
              <Activity className="w-4 h-4" />
              <span className="hidden sm:inline">Live</span>
            </TabsTrigger>
            <TabsTrigger value="server" className="gap-2">
              <Server className="w-4 h-4" />
              <span className="hidden sm:inline">Server</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2">
              <ScrollText className="w-4 h-4" />
              <span className="hidden sm:inline">Logs</span>
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Users</span>
            </TabsTrigger>
            <TabsTrigger value="plans" className="gap-2">
              <Gift className="w-4 h-4" />
              <span className="hidden sm:inline">Plans</span>
            </TabsTrigger>
            <TabsTrigger value="discord" className="gap-2">
              <MessageSquare className="w-4 h-4" />
              <span className="hidden sm:inline">Discord</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="live">
            <LivePanel />
          </TabsContent>

          <TabsContent value="server">
            <ServerPanel />
          </TabsContent>

          <TabsContent value="logs">
            <LogsPanel />
          </TabsContent>

          <TabsContent value="users">
            <UsersPanel userRole={userRole} userId={userId} userEmail={userEmail} />
          </TabsContent>

          <TabsContent value="plans">
            <PlansPanel />
          </TabsContent>

          <TabsContent value="discord">
            <DiscordPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
