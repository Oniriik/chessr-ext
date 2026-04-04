'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Crown, Loader2 } from 'lucide-react'

export function UpgradeButton({ children, className }: { children?: React.ReactNode; className?: string }) {
  const [loading, setLoading] = useState(false)

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const serverUrl = (process.env.NEXT_PUBLIC_CHESSR_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http')
      const res = await fetch(`${serverUrl}/api/paddle/billing-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!res.ok) return

      const { token } = await res.json()
      const returnUrl = window.location.href
      const userId = session.user?.id || ''
      window.location.href = `https://chessr.io/checkout?t=${encodeURIComponent(token)}&discount=earlyaccess&uid=${encodeURIComponent(userId)}&return=${encodeURIComponent(returnUrl)}`
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleUpgrade}
      disabled={loading}
      className={className || 'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90 transition-opacity'}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
      {children || 'Upgrade to Premium'}
    </button>
  )
}
