'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { NavBar } from '@/components/nav-bar'
import { Loader2 } from 'lucide-react'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<{ email: string; id: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reviewLimit, setReviewLimit] = useState<{ isLimited: boolean; dailyUsage: number; dailyLimit: number | null } | null>(null)
  const [animatedBg, setAnimatedBg] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('chessr_animated_bg') !== 'off'
    return true
  })

  const toggleBg = () => {
    const next = !animatedBg
    setAnimatedBg(next)
    localStorage.setItem('chessr_animated_bg', next ? 'on' : 'off')
  }

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUser({ email: user.email || '', id: user.id })
      setLoading(false)

      // Fetch review limit
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          const res = await fetch('/api/review-limit', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          setReviewLimit(await res.json())
        }
      } catch { /* ignore */ }
    }
    init()
  }, [router])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      {animatedBg && (
        <div className="animated-bg">
          <div className="bg-grid" />
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
          <div className="bg-particles">
            {Array.from({ length: 8 }, (_, i) => (
              <div
                key={i}
                className="particle"
                style={{
                  left: `${10 + i * 11}%`,
                  top: `${15 + (i % 3) * 25}%`,
                  animationDelay: `${i * 0.8}s`,
                  animationDuration: `${5 + (i % 3) * 2}s`,
                }}
              />
            ))}
          </div>
        </div>
      )}
      <NavBar userEmail={user?.email} reviewLimit={reviewLimit} animatedBg={animatedBg} onToggleBg={toggleBg} />
      <div className="relative z-10">
        {children}
      </div>
    </div>
  )
}
