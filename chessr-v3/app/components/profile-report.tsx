'use client'

/**
 * Profile Analysis report v2 — one hero, a cadence selector, and two
 * tabs: Fair Play (anti-cheat) and Learning (coaching). Replaces the
 * stacked per-cadence sections of v1.
 *
 * Everything renders off computePlayDNA's CadenceProfile — this file
 * owns zero scoring logic. Enriched-only features (eval sparklines,
 * clutch check…) degrade silently on pre-enrichment analyses: the
 * compute layer hands null/absent and the section hides itself.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronDown, Crown, Dna, Eye, EyeOff, Flag, Flame,
  GraduationCap, Shield, ShieldCheck, Swords, Target, TrendingUp, Zap,
} from 'lucide-react'
import { TcIcon } from '@/components/tc-icon'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import type { CadenceProfile, FairPlayCategory, FairPlayCheck, ProfileAnalysisResult } from '@/lib/play-dna'

type ProfileInfo = {
  avatar: string; name: string; username: string; joined: string;
  title?: string; totalGames?: number;
  bullet?: number; blitz?: number; rapid?: number;
  peak?: { mode: string; rating: number };
  joinedTimestamp?: number;
}

// ─── Root ────────────────────────────────────────────────────────────────

export function AnalysisReport({ result, profile, anonymous }: {
  result: ProfileAnalysisResult; profile: ProfileInfo | null; anonymous?: boolean
}) {
  const cadences = result.cadences
  const [tcType, setTcType] = useState(
    () => [...cadences].sort((a, b) => b.gamesCount - a.gamesCount)[0]?.tcType
  )
  const [tab, setTab] = useState<'fairplay' | 'learning'>('fairplay')
  const cadence = cadences.find(c => c.tcType === tcType) ?? cadences[0]

  // Opponent avatars for the game log
  const [opponentAvatars, setOpponentAvatars] = useState<Record<string, string>>({})
  useEffect(() => {
    const uniqueNames = [...new Set(cadences.flatMap(c => c.games.map(g => g.opponentName)))]
    const fetchAvatars = async () => {
      const avatars: Record<string, string> = {}
      await Promise.allSettled(uniqueNames.map(async (name) => {
        try {
          const res = await fetch(`https://api.chess.com/pub/player/${name}`, { headers: { 'User-Agent': 'Chessr/1.0' } })
          if (res.ok) {
            const data = await res.json()
            if (data.avatar) avatars[name] = data.avatar
          }
        } catch { /* skip */ }
      }))
      setOpponentAvatars(avatars)
    }
    fetchAvatars()
  }, [cadences])

  if (!cadence) return null

  return (
    <div className="space-y-4">
      <HeroCard
        result={result} profile={profile} anonymous={anonymous}
        cadence={cadence} cadences={cadences}
        tcType={tcType} onTcChange={setTcType}
        tab={tab} onTabChange={setTab}
      />
      {tab === 'fairplay'
        ? <FairPlayTab cadence={cadence} anonymous={anonymous} />
        : <LearningTab cadence={cadence} opponentAvatars={opponentAvatars} anonymous={anonymous} />}
    </div>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────

function HeroCard({ result, profile, anonymous, cadence, cadences, tcType, onTcChange, tab, onTabChange }: {
  result: ProfileAnalysisResult; profile: ProfileInfo | null; anonymous?: boolean
  cadence: CadenceProfile; cadences: CadenceProfile[]
  tcType: CadenceProfile['tcType'] | undefined; onTcChange: (tc: CadenceProfile['tcType']) => void
  tab: 'fairplay' | 'learning'; onTabChange: (t: 'fairplay' | 'learning') => void
}) {
  const wins = cadence.games.filter(g => g.result === 'W').length
  const draws = cadence.games.filter(g => g.result === 'D').length
  const losses = cadence.games.filter(g => g.result === 'L').length
  const winRate = cadence.gamesCount > 0 ? Math.round((wins / cadence.gamesCount) * 100) : 0

  return (
    <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8">
        {/* Identity */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {anonymous ? (
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center shrink-0">
              <EyeOff className="w-6 h-6 text-muted-foreground" />
            </div>
          ) : profile?.avatar ? (
            <img src={profile.avatar} alt={result.username} className="w-14 h-14 rounded-2xl border-2 border-border/40 shrink-0" />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground shrink-0">
              {result.username[0]?.toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {!anonymous && profile?.title && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">{profile.title}</span>
              )}
              <h1 className="text-xl font-bold truncate">{anonymous ? 'Anonymous' : result.username}</h1>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {!anonymous && profile?.joined && <span>Joined {profile.joined} · </span>}
              {profile?.totalGames != null && <span>{profile.totalGames.toLocaleString()} games · </span>}
              <span className="text-emerald-400 font-medium">{wins}W</span>
              {draws > 0 && <span> {draws}D</span>}
              <span className="text-rose-400 font-medium"> {losses}L</span>
              <span> on this sample</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {profile?.bullet != null && <RatingPill tc="bullet" value={profile.bullet} />}
              {profile?.blitz != null && <RatingPill tc="blitz" value={profile.blitz} />}
              {profile?.rapid != null && <RatingPill tc="rapid" value={profile.rapid} />}
              {profile?.peak && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs font-semibold">
                  <Crown className="w-3 h-3 text-amber-400" /> <span className="text-amber-300">{profile.peak.rating}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick stats for the active cadence */}
        <div className="flex items-center justify-between md:justify-start gap-4 sm:gap-7 shrink-0">
          <QuickStat value={`${cadence.gamesCount}`} label="games" />
          <QuickStat value={`${winRate}%`} label="win rate" color="text-emerald-400" />
          <QuickStat value={cadence.avgAccuracy != null ? cadence.avgAccuracy.toFixed(1) : '-'} label="accuracy" color="text-sky-400" />
          <QuickStat value={`${cadence.bestMoveRate.toFixed(0)}%`} label="best moves" color="text-amber-400" />
        </div>
      </div>

      {/* Cadence pills + tabs */}
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <div className="flex gap-1.5">
          {cadences.map(c => (
            <button
              key={c.tcType}
              onClick={() => onTcChange(c.tcType)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                c.tcType === tcType
                  ? 'bg-primary/15 border-primary/50 text-primary'
                  : 'border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/40'
              }`}
            >
              <TcIcon tc={c.tcType} className="w-3.5 h-3.5" colored />
              {c.tcLabel} <span className="opacity-60 font-medium">{c.gamesCount}</span>
            </button>
          ))}
        </div>
        <div className="w-full sm:w-auto sm:ml-auto flex gap-1 bg-muted/40 border border-border/40 rounded-xl p-1">
          <button
            onClick={() => onTabChange('fairplay')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${tab === 'fairplay' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <ShieldCheck className="w-4 h-4" /> Fair Play
          </button>
          <button
            onClick={() => onTabChange('learning')}
            className={`flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${tab === 'learning' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <GraduationCap className="w-4 h-4" /> Learning
          </button>
        </div>
      </div>
    </div>
  )
}

function RatingPill({ tc, value }: { tc: string; value: number }) {
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-muted/50 border border-border/30 text-xs font-semibold">
      <TcIcon tc={tc} className="w-3 h-3" colored /> {value}
    </span>
  )
}

function QuickStat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-extrabold leading-none tabular-nums ${color || ''}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</div>
    </div>
  )
}

// ─── Fair Play tab ───────────────────────────────────────────────────────

function FairPlayTab({ cadence, anonymous }: { cadence: CadenceProfile; anonymous?: boolean }) {
  const fp = cadence.fairPlay
  return (
    <>
      {/* Verdict */}
      <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing score={fp.score} riskLevel={fp.riskLevel} />
          <div className="flex-1 text-center sm:text-left">
            <p className="text-base font-bold">{fp.verdictTitle}</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">{fp.verdict}</p>
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/40 bg-muted/30 text-xs font-medium text-muted-foreground">
                <span className={`w-1.5 h-1.5 rounded-full ${fp.confidence === 'high' ? 'bg-emerald-400' : fp.confidence === 'medium' ? 'bg-amber-400' : 'bg-rose-400'}`} />
                {fp.confidenceDetail}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Signals</h3>
          <span className="text-xs text-muted-foreground ml-auto">thresholds scaled to ~{Math.round(cadence.avgRating)} · {cadence.tcLabel.toLowerCase()}</span>
        </div>
        <div className="space-y-2">
          {fp.categories.map(cat => <CategoryRow key={cat.id} category={cat} />)}
        </div>
      </div>

      {/* Per-game timeline */}
      {fp.gameDeltas.filter(gd => gd.delta != null).length >= 4 && (
        <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Accuracy vs expected, per game</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">Baseline = the norm for this rating. A single game far above the rest is a selective-assistance pattern.</p>
          <GameDeltaTimeline deltas={fp.gameDeltas} anonymous={anonymous} />
          {fp.outlierNote && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{anonymous ? fp.outlierNote.replace(/vs \S+:/, 'vs opponent:') : fp.outlierNote}</span>
            </div>
          )}
        </div>
      )}
    </>
  )
}

const CATEGORY_ICONS: Record<FairPlayCategory['id'], React.ReactNode> = {
  performance: <Target className="w-4 h-4" />,
  errors: <Flame className="w-4 h-4" />,
  consistency: <Swords className="w-4 h-4" />,
  timing: <Zap className="w-4 h-4" />,
  strong: <AlertTriangle className="w-4 h-4" />,
}

function CategoryRow({ category }: { category: FairPlayCategory }) {
  // Categories with something to say start open
  const [open, setOpen] = useState(() => category.checks.some(c => c.status !== 'PASS'))
  const pct = category.max > 0 ? category.earned / category.max : 1
  const scoreColor = pct >= 0.75 ? 'text-emerald-400' : pct >= 0.4 ? 'text-amber-400' : 'text-rose-400'

  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="w-8 h-8 rounded-lg bg-muted/60 flex items-center justify-center text-muted-foreground shrink-0">
          {CATEGORY_ICONS[category.id]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{category.label}</span>
          <span className="block text-[11px] text-muted-foreground truncate">{category.description}</span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          <span className="hidden sm:flex gap-1">
            {category.checks.map((c, i) => (
              <span key={i} className={`w-2 h-2 rounded-[3px] ${c.status === 'PASS' ? 'bg-emerald-400' : c.status === 'WARN' ? 'bg-amber-400' : 'bg-rose-400'}`} />
            ))}
          </span>
          <span className={`text-sm font-extrabold tabular-nums ${scoreColor}`}>{category.earned} / {category.max}</span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-4 py-1">
          {category.checks.map(c => <CheckRow key={c.id} check={c} />)}
        </div>
      )}
    </div>
  )
}

function CheckRow({ check }: { check: FairPlayCheck }) {
  const badge = check.status === 'PASS'
    ? 'text-emerald-400 bg-emerald-500/10'
    : check.status === 'WARN'
      ? 'text-amber-400 bg-amber-500/10'
      : 'text-rose-400 bg-rose-500/10'
  const valueColor = check.status === 'WARN' ? 'text-amber-400' : check.status === 'FAIL' ? 'text-rose-400' : ''
  return (
    <div className="py-2 border-b border-border/30 last:border-0" title={check.tooltip}>
      <div className="flex items-center gap-2.5">
        <span className={`text-[10px] font-extrabold tracking-wide rounded-md px-1.5 py-0.5 w-11 text-center shrink-0 ${badge}`}>{check.status}</span>
        <span className="text-[13px] font-semibold flex-1 min-w-0">{check.label}</span>
        {/* Desktop: value right of the label. Mobile: shown below instead. */}
        <span className={`hidden sm:block text-[13px] font-bold tabular-nums text-right shrink-0 ${valueColor}`}>{check.value}</span>
      </div>
      <div className="pl-[54px] mt-0.5">
        <div className={`sm:hidden text-[13px] font-bold tabular-nums ${valueColor}`}>{check.value}</div>
        <div className="text-xs text-muted-foreground">{check.detail}</div>
      </div>
    </div>
  )
}

function ScoreRing({ score, riskLevel, size = 120 }: { score: number; riskLevel: string; size?: number }) {
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (score / 10) * circumference
  const color = riskLevel === 'LOW' ? '#34d399' : riskLevel === 'MEDIUM' ? '#fbbf24' : '#f87171'
  const bgColor = riskLevel === 'LOW' ? 'rgba(52,211,153,0.08)' : riskLevel === 'MEDIUM' ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)'
  const label = riskLevel === 'LOW' ? 'Legit' : riskLevel === 'MEDIUM' ? 'Suspicious' : 'Flagged'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill={bgColor} stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={circumference - progress}
          className="transition-all duration-1000"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black leading-none tabular-nums" style={{ color }}>{score % 1 === 0 ? score : score.toFixed(1)}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">/ 10</span>
        <span className="text-[11px] font-semibold mt-1 px-2 py-0.5 rounded-full" style={{ color, backgroundColor: bgColor }}>{label}</span>
      </div>
    </div>
  )
}

function GameDeltaTimeline({ deltas, anonymous }: { deltas: CadenceProfile['fairPlay']['gameDeltas']; anonymous?: boolean }) {
  const valid = deltas.filter(d => d.delta != null)
  const maxAbs = Math.max(12, ...valid.map(d => Math.abs(d.delta!)))
  return (
    <div>
      <div className="relative flex items-stretch gap-1 h-24">
        <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-border/60 pointer-events-none" />
        {deltas.map((d, i) => {
          if (d.delta == null) return <div key={d.gameId} className="flex-1" />
          const h = Math.min(48, (Math.abs(d.delta) / maxAbs) * 48)
          const up = d.delta >= 0
          return (
            <div
              key={d.gameId}
              className="flex-1 relative group"
              title={`Game ${i + 1} vs ${anonymous ? 'opponent' : d.opponentName} · ${d.delta >= 0 ? '+' : ''}${d.delta.toFixed(1)} pts · ${d.result}`}
            >
              <div
                className={`absolute left-0 right-0 rounded-[4px] transition-all group-hover:brightness-125 ${d.outlier ? 'bg-amber-400' : 'bg-primary/40'}`}
                style={up ? { bottom: '50%', height: `${h}%` } : { top: '50%', height: `${h}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground mt-2">
        <span>Game 1</span>
        <span>Game {deltas.length}</span>
      </div>
    </div>
  )
}

// ─── Learning tab ────────────────────────────────────────────────────────

function LearningTab({ cadence, opponentAvatars, anonymous }: {
  cadence: CadenceProfile; opponentAvatars: Record<string, string>; anonymous?: boolean
}) {
  const c = cadence
  const radarData = useMemo(() => c.pieces.map(p => ({ piece: p.label, value: p.mean, fullMark: 100 })), [c.pieces])

  return (
    <>
      {/* Style + phases / radar */}
      <div className="report-section grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border/60 bg-gradient-to-r from-primary/5 via-card/50 to-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Swords className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-primary">{c.style}</h2>
              <p className="text-xs text-muted-foreground">Based on {c.gamesCount} {c.tcLabel.toLowerCase()} games</p>
            </div>
          </div>
          <div className="space-y-3.5">
            {c.phases.map(p => {
              const isBest = p.phase === c.bestPhase?.phase
              const isWorst = p.phase === c.worstPhase?.phase
              const color = isBest ? 'bg-emerald-400' : isWorst ? 'bg-rose-400' : 'bg-violet-400'
              const textColor = isBest ? 'text-emerald-400' : isWorst ? 'text-rose-400' : 'text-violet-400'
              return (
                <div key={p.phase}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      {p.label}
                      {isBest && <span className="text-[9px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full font-bold">BEST</span>}
                      {isWorst && <span className="text-[9px] text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded-full font-bold">WEAKEST</span>}
                    </span>
                    <span className={`text-sm font-bold tabular-nums ${textColor}`}>{p.mean.toFixed(1)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${Math.min(100, p.mean)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-1">
            <Dna className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Piece Mastery</h3>
          </div>
          <div className="h-[200px] -mx-4" style={{ minWidth: 200, minHeight: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis
                  dataKey="piece"
                  tick={({ x, y, payload }: any) => {
                    const item = radarData.find((d: any) => d.piece === payload.value)
                    return (
                      <g>
                        <text x={x} y={y} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize={12}>{payload.value}</text>
                        <text x={x} y={y + 13} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize={10}>
                          {item ? `${item.value.toFixed(0)}%` : ''}
                        </text>
                      </g>
                    )
                  }}
                />
                <Radar dataKey="value" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between text-xs mt-1">
            {c.strongestPiece && (
              <span className="text-emerald-400 flex items-center gap-1">
                <Crown className="w-3 h-3" /> Best: {c.strongestPiece.label} ({c.strongestPiece.mean.toFixed(0)}%)
              </span>
            )}
            {c.weakestPiece && (
              <span className="text-rose-400">Weakest: {c.weakestPiece.label} ({c.weakestPiece.mean.toFixed(0)}%)</span>
            )}
          </div>
        </div>
      </div>

      {/* Openings */}
      {c.openings.length > 0 && (
        <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Flag className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Opening Repertoire</h3>
            <span className="text-xs text-muted-foreground ml-auto">{c.gamesCount} {c.tcLabel.toLowerCase()} games</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-bold pb-2 pr-3">Opening</th>
                  <th className="text-right font-bold pb-2 px-2">Games</th>
                  <th className="text-right font-bold pb-2 px-2">Acc.</th>
                  <th className="text-right font-bold pb-2 pl-3">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {c.openings.map(o => (
                  <tr key={o.name} className={`border-t border-border/30 ${o.worst ? 'bg-rose-500/5' : ''}`}>
                    <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">
                      {o.name}
                      {o.eco && <span className="hidden sm:inline text-[10px] text-muted-foreground font-medium ml-2">{o.eco}</span>}
                      {o.worst && <span className="text-[9px] font-bold text-rose-400 bg-rose-400/10 rounded-full px-1.5 py-0.5 ml-2 align-[2px]">WEAKEST</span>}
                    </td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{o.games}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{o.avgAccuracy != null ? o.avgAccuracy.toFixed(1) : '-'}</td>
                    <td className="py-2.5 pl-3 text-right tabular-nums whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {o.winRate}%
                        <span className="w-10 sm:w-14 h-1.5 rounded-full bg-muted/60 overflow-hidden inline-block">
                          <span className={`block h-full rounded-full ${o.worst ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ width: `${o.winRate}%` }} />
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Focus areas */}
      {c.focusAreas.length > 0 && (
        <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Focus Areas</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {c.focusAreas.map((f, i) => (
              <div key={i} className="rounded-xl border border-border/50 bg-muted/20 p-4">
                <div className="text-lg">{f.icon}</div>
                <div className="text-sm font-bold mt-1.5">{f.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{f.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Game log */}
      <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Game Log</h3>
          <span className="text-xs text-muted-foreground ml-auto">{c.games.length} games</span>
        </div>
        <div className="space-y-2">
          {c.games.map((g, i) => (
            <GameRow key={g.gameId} game={g} index={i} avatar={opponentAvatars[g.opponentName]} anonymous={anonymous} />
          ))}
        </div>
      </div>
    </>
  )
}

function GameRow({ game: g, index, avatar, anonymous }: {
  game: CadenceProfile['games'][number]; index: number; avatar?: string; anonymous?: boolean
}) {
  const resStyle = g.result === 'W'
    ? 'bg-emerald-500/15 text-emerald-400'
    : g.result === 'L'
      ? 'bg-rose-500/10 text-rose-400'
      : 'bg-muted/60 text-muted-foreground'
  const accColor = g.accuracy == null ? 'text-muted-foreground'
    : g.accuracy >= 90 ? 'text-emerald-400'
    : g.accuracy >= 75 ? 'text-sky-400'
    : g.accuracy >= 60 ? 'text-amber-400'
    : 'text-rose-400'

  const hasSubline = !!g.openingName || (g.keyMoment != null && g.keyMoment.swing >= 1.5)

  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 px-3.5 py-2.5">
      <div className="flex items-center gap-2.5 sm:gap-3">
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0 ${resStyle}`}>{g.result}</span>
        {!anonymous && avatar && <img src={avatar} alt="" className="hidden sm:block w-6 h-6 rounded-md shrink-0" />}
        <a
          href={`https://www.chess.com/game/live/${g.gameId}`}
          target="_blank" rel="noopener noreferrer"
          className="text-sm font-semibold hover:text-primary truncate flex-1 min-w-0"
        >
          vs {anonymous ? `Opponent ${index + 1}` : g.opponentName}
          <span className="text-muted-foreground font-medium"> ({g.opponentRating})</span>
        </a>
        {g.evalSeries && <EvalSparkline series={g.evalSeries} result={g.result} />}
        <span className={`text-sm font-extrabold tabular-nums w-11 text-right shrink-0 ${accColor}`}>{g.accuracy != null ? g.accuracy.toFixed(1) : '-'}</span>
      </div>
      {hasSubline && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 pl-[38px] sm:pl-10">
          {g.openingName && (
            <span className="text-[10px] font-medium text-muted-foreground border border-border/40 rounded-md px-1.5 py-0.5 truncate max-w-[180px]">{g.openingName}</span>
          )}
          {g.keyMoment && g.keyMoment.swing >= 1.5 && (
            <span className="text-[11px] text-muted-foreground">
              Key moment: <span className="text-amber-400 font-semibold">
                move {Math.ceil(g.keyMoment.ply / 2)}{g.keyMoment.san ? ` ${g.keyMoment.san}` : ''} (−{g.keyMoment.swing.toFixed(1)})
              </span>
              {g.keyMoment.thinkTime != null && <span> — in {g.keyMoment.thinkTime.toFixed(1)}s</span>}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function EvalSparkline({ series, result }: { series: number[]; result: string }) {
  const W = 130, H = 30
  // Downsample to ≤ 48 points
  const step = Math.max(1, Math.ceil(series.length / 48))
  const pts = series.filter((_, i) => i % step === 0 || i === series.length - 1)
  const path = pts
    .map((v, i) => {
      const x = (i / Math.max(1, pts.length - 1)) * W
      const y = H / 2 - (v / 6) * (H / 2 - 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const color = result === 'W' ? '#34d399' : result === 'L' ? '#f87171' : '#a1a1aa'
  const last = pts[pts.length - 1] ?? 0
  const lastY = H / 2 - (last / 6) * (H / 2 - 2)

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="hidden sm:block shrink-0" aria-label="Eval curve">
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" />
      <circle cx={W} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}
