'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { computePlayDNA, type GameRawData, type ProfileAnalysisResult } from '@/lib/play-dna'
import { Button } from '@/components/ui/button'
import { Loader2, Play, Clock, CheckCircle2, XCircle, Shield, Swords, Target, Zap, TrendingUp, ChevronRight, Dna, Crown, Flame } from 'lucide-react'
import { AccountSelector } from '@/components/account-selector'
import { TcIcon } from '@/components/tc-icon'
import { UpgradeButton } from '@/components/upgrade-button'

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
  games_requested: number | null
  created_at: string
  completed_at: string | null
  error_message: string | null
  games_data: GameRawData[] | null
}

// Human score calculation (same as detail page)
const FLAG_PTS: Record<string, number> = { clean: 1, suspicious: 0.5, flagged: -0.5 }
const CHECK_PTS: Record<string, number> = { PASS: 1, WARN: 0.5, FAIL: -0.5 }
function combinedHumanScore(flags: { status: string; weight?: number }[], checks: { status: string }[]): number {
  const flagScore = Math.max(0, flags.reduce((sum, f) => sum + (FLAG_PTS[f.status] ?? 0) * (f.weight ?? 1), 0))
  const flagMax = flags.reduce((sum, f) => sum + (f.weight ?? 1), 0)
  const fairPlay = Math.max(0, checks.reduce((sum, c) => sum + (CHECK_PTS[c.status] ?? 0), 0))
  const norm = (s: number, m: number) => m > 0 ? Math.max(0, Math.round((s / m) * 100) / 10) : 0
  return Math.max(0, Math.round(((norm(flagScore, flagMax) + norm(fairPlay, checks.length)) / 2) * 10) / 10)
}

interface AnalysisSummary {
  accuracy: number | null
  humanScore: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  winRate: number
  wins: number
  losses: number
  draws: number
  style: string
  bestMoveRate: number
  avgRating: number
}

function computeSummary(gamesData: GameRawData[], username: string): AnalysisSummary | null {
  try {
    const dna = computePlayDNA(gamesData, username)
    const main = dna.cadences[0]
    if (!main) return null
    const hs = combinedHumanScore(main.flags, main.antiCheat.checks)
    const risk: 'LOW' | 'MEDIUM' | 'HIGH' = hs >= 7 ? 'LOW' : hs >= 4 ? 'MEDIUM' : 'HIGH'
    return {
      accuracy: main.avgAccuracy,
      humanScore: hs,
      riskLevel: risk,
      winRate: dna.gamesCount > 0 ? Math.round((dna.wins / dna.gamesCount) * 100) : 0,
      wins: dna.wins,
      losses: dna.losses,
      draws: dna.draws,
      style: main.style,
      bestMoveRate: main.bestMoveRate,
      avgRating: dna.avgRating,
    }
  } catch {
    return null
  }
}

export default function ProfileAnalysisPage() {
  const router = useRouter()
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [analyses, setAnalyses] = useState<ProfileAnalysis[]>([])
  const [analysesLoading, setAnalysesLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [gamesPerMode, setGamesPerMode] = useState(10)
  const [selectedModes, setSelectedModes] = useState<string[]>(['blitz'])
  const [analysisLimit, setAnalysisLimit] = useState<{ isLimited: boolean; weeklyUsage: number; weeklyLimit: number | null } | null>(null)
  const [showAnalysisConfirm, setShowAnalysisConfirm] = useState(false)

  // Compute summaries for completed analyses
  const summaries = useMemo(() => {
    const map: Record<string, AnalysisSummary> = {}
    for (const a of analyses) {
      if (a.status === 'success' && a.games_data) {
        const s = computeSummary(a.games_data, a.platform_username)
        if (s) map[a.id] = s
      }
    }
    return map
  }, [analyses])

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

  useEffect(() => {
    async function fetchLimit() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/profile-analysis-limit', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        setAnalysisLimit(await res.json())
      } catch { /* */ }
    }
    fetchLimit()
  }, [])

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
        body: JSON.stringify({ platformUsername: selectedAccount, modes: selectedModes, gamesPerMode }),
      })
      const data = await res.json()
      if (data.id) {
        router.push(`/profile-analysis/${data.id}`)
      } else if (data.existingId) {
        router.push(`/profile-analysis/${data.existingId}`)
      }
    } catch { /* */ } finally { setCreating(false) }
  }

  if (accountsLoading || (accounts.length > 0 && analysesLoading && analyses.length === 0)) {
    return (
      <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-6">
        <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-8 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
            <div className="space-y-2">
              <div className="h-6 w-56 bg-muted rounded animate-pulse" />
              <div className="h-4 w-72 bg-muted/60 rounded animate-pulse" />
            </div>
            <div className="h-10 w-44 bg-muted rounded-xl animate-pulse" />
          </div>
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card/50 p-5">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-muted rounded-xl animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-64 bg-muted/60 rounded animate-pulse" />
                  <div className="h-2 w-full bg-muted/30 rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    )
  }

  if (accounts.length === 0) {
    return (
      <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-12">
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold mb-2">No Chess.com accounts linked</h2>
          <p className="text-sm text-muted-foreground">Link your Chess.com account in the Chessr extension first.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-6">
      {/* Hero — Run New Analysis */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-r from-primary/5 via-card/50 to-card/50 backdrop-blur-sm p-5 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          {/* Left: settings */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {MODE_OPTIONS.map((id) => {
                const isSelected = selectedModes.includes(id)
                const isPremium = !analysisLimit?.isLimited
                return (
                  <button
                    key={id}
                    onClick={() => {
                      if (isPremium) {
                        // Multi-select: toggle mode, keep at least one
                        setSelectedModes(prev => {
                          if (prev.includes(id)) return prev.length > 1 ? prev.filter(m => m !== id) : prev
                          return [...prev, id]
                        })
                      } else {
                        // Single select for free users
                        setSelectedModes([id])
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isSelected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <TcIcon tc={id} className="w-3.5 h-3.5" colored={isSelected} />
                    {MODE_LABELS[id]}
                  </button>
                )
              })}
            </div>
            <div className="w-px h-6 bg-border/40" />
            <div className="flex items-center gap-1">
              {(analysisLimit?.isLimited ? GAMES_OPTIONS : GAMES_OPTIONS_PREMIUM).map((n) => (
                <button
                  key={n}
                  onClick={() => setGamesPerMode(n)}
                  className={`w-7 h-7 rounded-md text-[11px] font-bold transition-all ${
                    gamesPerMode === n
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {n}
                </button>
              ))}
              {analysisLimit?.isLimited && [15, 20, 30].map((n) => (
                <button
                  key={n}
                  disabled
                  className="w-7 h-7 rounded-md text-[11px] font-bold text-muted-foreground/25 cursor-not-allowed relative"
                  title="Premium"
                >
                  {n}
                </button>
              ))}
              <span className="text-[11px] text-muted-foreground ml-1.5">games</span>
            </div>
          </div>

          {/* Right: CTA */}
          {analysisLimit?.isLimited && analysisLimit.weeklyLimit != null && analysisLimit.weeklyUsage >= analysisLimit.weeklyLimit ? (
            <UpgradeButton>Unlock analyses</UpgradeButton>
          ) : (
            <Button
              onClick={() => {
                if (analysisLimit?.isLimited) {
                  setShowAnalysisConfirm(true)
                } else {
                  handleRunAnalysis()
                }
              }}
              disabled={creating}
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              Analyze {selectedModes.map(m => MODE_LABELS[m]).join(', ')}
              {analysisLimit?.isLimited && analysisLimit.weeklyLimit != null && (
                <span className="text-xs opacity-75 ml-1">({analysisLimit.weeklyUsage}/{analysisLimit.weeklyLimit})</span>
              )}
            </Button>
          )}
        </div>

        {/* Premium upsell — compact */}
        {analysisLimit?.isLimited && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
            <Crown className="w-3 h-3 text-amber-500/60 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              <span className="text-amber-400/80">Premium</span> — Multi-mode, up to 30 games, unlimited
            </span>
            <UpgradeButton className="ml-auto flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
              Upgrade
            </UpgradeButton>
          </div>
        )}
      </div>

      {/* Account selector */}
      <div className="mb-5">
        <AccountSelector accounts={accounts} selected={selectedAccount} onSelect={setSelectedAccount} />
      </div>

      {/* Analyses list */}
      {analysesLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/60 bg-card/50 p-5">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-muted rounded-xl animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                  <div className="h-3 w-64 bg-muted/60 rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : analyses.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-muted/30 flex items-center justify-center mx-auto mb-4">
            <Target className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">No analyses yet for this account.</p>
          <p className="text-xs text-muted-foreground">Run your first analysis to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {analyses.map((a, i) => (
            <AnalysisCard
              key={a.id}
              analysis={a}
              summary={summaries[a.id] ?? null}
              isLatest={i === 0}
              onClick={() => router.push(`/profile-analysis/${a.id}`)}
            />
          ))}
        </div>
      )}

      {/* Analysis confirmation dialog for free users */}
      {showAnalysisConfirm && analysisLimit?.isLimited && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowAnalysisConfirm(false)}>
          <div className="bg-card border border-border/60 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Start a profile analysis?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              You have <span className="font-medium text-foreground">{Math.max(0, (analysisLimit.weeklyLimit ?? 0) - analysisLimit.weeklyUsage)}</span> of{' '}
              <span className="font-medium text-foreground">{analysisLimit.weeklyLimit}</span> analyses remaining this week.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowAnalysisConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowAnalysisConfirm(false); handleRunAnalysis() }}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Start Analysis
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function AnalysisCard({ analysis: a, summary, isLatest, onClick }: {
  analysis: ProfileAnalysis
  summary: AnalysisSummary | null
  isLatest: boolean
  onClick: () => void
}) {
  const isSuccess = a.status === 'success'
  const isError = a.status === 'error'
  const isRunning = a.status === 'analyzing' || a.status === 'pending'
  const gamesLabel = a.games_count ?? a.games_requested ?? '?'
  const timeAgo = getTimeAgo(a.created_at)

  // Completed analysis with summary data
  if (isSuccess && summary) {
    const hsColor = summary.riskLevel === 'LOW' ? '#34d399' : summary.riskLevel === 'MEDIUM' ? '#fbbf24' : '#f87171'
    const hsBg = summary.riskLevel === 'LOW' ? 'rgba(52,211,153,0.08)' : summary.riskLevel === 'MEDIUM' ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)'
    const hsLabel = summary.riskLevel === 'LOW' ? 'Legit' : summary.riskLevel === 'MEDIUM' ? 'Suspicious' : 'Flagged'

    return (
      <div
        onClick={onClick}
        className={`group rounded-2xl border bg-card/50 backdrop-blur-sm cursor-pointer transition-all hover:bg-card/70 overflow-hidden ${
          isLatest ? 'border-primary/30 hover:border-primary/50' : 'border-border/60 hover:border-border/80'
        }`}
      >
        <div className="p-4 sm:p-5">
          {/* Top row: username + time + latest badge */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{a.platform_username}</span>
              {isLatest && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">LATEST</span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span>{timeAgo}</span>
              <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Main content: stats + score ring */}
          <div className="flex items-center gap-4 sm:gap-6">
            {/* Left: Human score mini ring */}
            <div className="shrink-0">
              <MiniScoreRing score={summary.humanScore} riskLevel={summary.riskLevel} />
            </div>

            {/* Center: stats + W/L/D */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-5 sm:gap-6 flex-wrap">
                <div>
                  <span className="text-lg font-bold text-sky-400">{summary.accuracy != null ? `${summary.accuracy.toFixed(1)}` : '-'}</span>
                  <span className="text-xs text-sky-400/70">%</span>
                  <span className="text-[10px] text-muted-foreground ml-1">accuracy</span>
                </div>
                <div>
                  <span className="text-lg font-bold text-amber-400">{summary.bestMoveRate.toFixed(0)}</span>
                  <span className="text-xs text-amber-400/70">%</span>
                  <span className="text-[10px] text-muted-foreground ml-1">best moves</span>
                </div>
                <div>
                  <span className="text-lg font-bold text-emerald-400">{summary.winRate}</span>
                  <span className="text-xs text-emerald-400/70">%</span>
                  <span className="text-[10px] text-muted-foreground ml-1">win rate</span>
                </div>
                <div>
                  <span className="text-lg font-bold">{gamesLabel}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">games</span>
                </div>
              </div>

              {/* W/L/D bar */}
              <div className="mt-3">
                <MiniWinLossBar wins={summary.wins} losses={summary.losses} draws={summary.draws} />
              </div>
            </div>
          </div>

          {/* Bottom: style + rating */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border/30">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Flame className="w-3 h-3" />
              <span className="font-medium text-foreground/80">{summary.style}</span>
            </span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Crown className="w-3 h-3" />
              Avg {Math.round(summary.avgRating)}
            </span>
            <div className="ml-auto">
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                style={{ color: hsColor, backgroundColor: hsBg, borderColor: `${hsColor}33` }}
              >
                {hsLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Running / Error / Success without summary
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border bg-card/50 backdrop-blur-sm p-4 sm:p-5 cursor-pointer transition-all hover:bg-card/70 hover:border-border/80 group ${
        isLatest && isSuccess ? 'border-primary/30' : 'border-border/60'
      }`}
    >
      <div className="flex items-center gap-4">
        {/* Status icon */}
        <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
          isSuccess ? 'bg-emerald-500/10' :
          isError ? 'bg-rose-500/10' :
          isRunning ? 'bg-sky-500/10' : 'bg-muted/30'
        }`}>
          {isSuccess ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> :
           isError ? <XCircle className="w-6 h-6 text-rose-400" /> :
           isRunning ? <Loader2 className="w-6 h-6 text-sky-400 animate-spin" /> :
           <Clock className="w-6 h-6 text-amber-400" />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm">{a.platform_username}</span>
            {isLatest && isSuccess && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">LATEST</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Swords className="w-3 h-3" />
              {gamesLabel} games
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo}
            </span>
            {a.error_message && (
              <span className="text-rose-400 truncate max-w-48">{a.error_message}</span>
            )}
          </div>

          {/* Progress bar for running analyses */}
          {isRunning && (
            <div className="mt-2.5 w-full">
              <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden">
                <div className="h-full rounded-full bg-sky-400/60 animate-pulse" style={{ width: a.status === 'pending' ? '15%' : '60%' }} />
              </div>
              <span className="text-[10px] text-muted-foreground mt-1 block">
                {a.status === 'pending' ? 'Queued...' : 'Analyzing games...'}
              </span>
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="shrink-0">
          {isRunning ? (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
              {a.status === 'pending' ? 'Queued' : 'Analyzing'}
            </span>
          ) : isError ? (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              Failed
            </span>
          ) : (
            <ChevronRight className="w-5 h-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </div>
    </div>
  )
}

function MiniScoreRing({ score, riskLevel }: { score: number; riskLevel: string }) {
  const size = 72
  const strokeWidth = 5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (score / 10) * circumference
  const color = riskLevel === 'LOW' ? '#34d399' : riskLevel === 'MEDIUM' ? '#fbbf24' : '#f87171'
  const bgColor = riskLevel === 'LOW' ? 'rgba(52,211,153,0.1)' : riskLevel === 'MEDIUM' ? 'rgba(251,191,36,0.1)' : 'rgba(248,113,113,0.1)'

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill={bgColor} stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference - progress}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black leading-none" style={{ color }}>
          {score % 1 === 0 ? score : score.toFixed(1)}
        </span>
        <span className="text-[9px] text-muted-foreground">/10</span>
      </div>
    </div>
  )
}

function MiniStat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-muted/30 border border-border/20">
      {icon}
      <div className="min-w-0">
        <span className="text-sm font-bold leading-none block">{value}</span>
        <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
      </div>
    </div>
  )
}

function MiniWinLossBar({ wins, losses, draws }: { wins: number; losses: number; draws: number }) {
  const total = wins + losses + draws
  if (total === 0) return null
  const wp = (wins / total) * 100
  const dp = (draws / total) * 100
  const lp = (losses / total) * 100

  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
        {wp > 0 && <div className="bg-emerald-400 rounded-l-full" style={{ width: `${wp}%` }} />}
        {dp > 0 && <div className="bg-zinc-500" style={{ width: `${dp}%` }} />}
        {lp > 0 && <div className="bg-rose-400 rounded-r-full" style={{ width: `${lp}%` }} />}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
        <span className="text-emerald-400 font-medium">{wins}W</span>
        {draws > 0 && <span>{draws}D</span>}
        <span className="text-rose-400 font-medium">{losses}L</span>
      </div>
    </div>
  )
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diffMs = now - date
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const MODE_OPTIONS = ['bullet', 'blitz', 'rapid']
const MODE_LABELS: Record<string, string> = { bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid' }


const GAMES_OPTIONS = [5, 10]
const GAMES_OPTIONS_PREMIUM = [5, 10, 15, 20, 30]

