'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Loader2, ChevronDown, Play, Clock, CheckCircle2, XCircle, AlertTriangle, Shield } from 'lucide-react'

interface LinkedAccount {
  id: string
  platform: string
  platform_username: string
}

interface ProfileAnalysis {
  id: string
  platform_username: string
  status: 'pending' | 'analyzing' | 'success' | 'error'
  games_count: number | null
  created_at: string
  completed_at: string | null
  error_message: string | null
}

export default function ProfileAnalysisPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [analyses, setAnalyses] = useState<ProfileAnalysis[]>([])
  const [analysesLoading, setAnalysesLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [gamesCount, setGamesCount] = useState(10)

  // Fetch linked accounts
  useEffect(() => {
    async function fetchAccounts() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch('/api/linked-accounts', {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        const data = await res.json()
        const accs = data.accounts || []
        setAccounts(accs)
        if (accs.length > 0) {
          const saved = localStorage.getItem('chessr_selected_account')
          const match = saved && accs.find((a: LinkedAccount) => a.platform_username === saved)
          setSelectedAccount(match ? saved : accs[0].platform_username)
        }
      } catch { /* */ } finally { setAccountsLoading(false) }
    }
    fetchAccounts()
  }, [])

  // Fetch analyses when account changes
  useEffect(() => {
    if (!selectedAccount) return
    setAnalysesLoading(true)
    async function fetchAnalyses() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`/api/profile-analysis?username=${selectedAccount}`, {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        const data = await res.json()
        setAnalyses(data.analyses || [])
      } catch { /* */ } finally { setAnalysesLoading(false) }
    }
    fetchAnalyses()
  }, [selectedAccount])

  const handleRunAnalysis = async () => {
    if (!selectedAccount || creating) return
    setCreating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/profile-analysis', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ platformUsername: selectedAccount, gamesCount }),
      })
      const data = await res.json()
      if (data.id) {
        router.push(`/profile-analysis/${data.id}`)
      } else if (data.existingId) {
        router.push(`/profile-analysis/${data.existingId}`)
      }
    } catch { /* */ } finally { setCreating(false) }
  }

  const lastSuccess = analyses.find(a => a.status === 'success')

  if (accountsLoading) {
    return (
      <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-12">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading...
        </div>
      </main>
    )
  }

  if (accounts.length === 0) {
    return (
      <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-12">
        <div className="text-center py-12">
          <Shield className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-2">No Chess.com accounts linked</p>
          <p className="text-sm text-muted-foreground">Link your Chess.com account in the Chessr extension first.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-6">
      {/* Header card */}
      <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6 mb-6">
        {lastSuccess ? (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-semibold mb-1">Last Profile Analysis</h2>
              <p className="text-xs sm:text-sm text-muted-foreground">
                {lastSuccess.platform_username} — {lastSuccess.games_count} games — {new Date(lastSuccess.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <GamesCountSelector value={gamesCount} onChange={setGamesCount} compact />
              <Button onClick={handleRunAnalysis} disabled={creating} className="w-full sm:w-auto">
                {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                Run New Analysis
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <Shield className="w-10 h-10 text-primary mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-1">Profile Analysis</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Analyze your recent games to get your Play DNA and anti-cheat report.
            </p>
            <GamesCountSelector value={gamesCount} onChange={setGamesCount} />
            <Button onClick={handleRunAnalysis} disabled={creating} size="lg" className="mt-4">
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              Start Your Profile Analysis
            </Button>
          </div>
        )}
      </div>

      {/* Account selector */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-muted-foreground">Account:</span>
        <div className="relative">
          <select
            value={selectedAccount || ''}
            onChange={(e) => { setSelectedAccount(e.target.value); localStorage.setItem('chessr_selected_account', e.target.value) }}
            className="appearance-none bg-muted border border-border rounded-lg px-3 py-1.5 pr-8 text-sm font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.platform_username}>{acc.platform_username}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Analyses list */}
      {analysesLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading analyses...
        </div>
      ) : analyses.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No analyses yet for this account.</p>
      ) : (
        <div className="space-y-2">
          {analyses.map((a) => (
            <div
              key={a.id}
              onClick={() => router.push(`/profile-analysis/${a.id}`)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-card/50 backdrop-blur-sm hover:bg-card/70 transition-colors cursor-pointer border border-border/60"
            >
              <StatusIcon status={a.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{a.platform_username}</span>
                  {a.games_count && <span className="text-muted-foreground">{a.games_count} games</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {a.error_message && <span className="text-rose-400 ml-2">{a.error_message}</span>}
                </div>
              </div>
              <StatusBadge status={a.status} />
            </div>
          ))}
        </div>
      )}
    </main>
  )
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success': return <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
    case 'error': return <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
    case 'analyzing': return <Loader2 className="w-5 h-5 text-sky-400 animate-spin shrink-0" />
    case 'pending': return <Clock className="w-5 h-5 text-amber-400 shrink-0" />
    default: return <AlertTriangle className="w-5 h-5 text-muted-foreground shrink-0" />
  }
}

const GAMES_OPTIONS = [5, 10, 15, 20, 30]

function GamesCountSelector({ value, onChange, compact }: { value: number; onChange: (n: number) => void; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${compact ? '' : 'justify-center'}`}>
      {!compact && <span className="text-xs text-muted-foreground mr-1">Games:</span>}
      {GAMES_OPTIONS.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
            value === n
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    error: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    analyzing: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
    pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  }
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${styles[status] || 'bg-muted text-muted-foreground border-border'}`}>
      {status}
    </span>
  )
}
