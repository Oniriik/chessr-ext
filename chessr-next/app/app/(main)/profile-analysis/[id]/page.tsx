'use client'

import { useEffect, useState, useRef, useCallback, use, memo } from 'react'
import { supabase } from '@/lib/supabase'
import { computePlayDNA, type GameRawData, type ProfileAnalysisResult } from '@/lib/play-dna'
import { CheckCircle2, Shield, AlertTriangle, ChevronLeft, Search, Dna, Timer, ShieldCheck, Flag, Clock, ChevronDown, Zap, Target, Brain, Flame, Crown, Swords, TrendingUp, Eye, XCircle, CircleAlert, Crosshair } from 'lucide-react'
import { TcIcon, TC_LABELS } from '@/components/tc-icon'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import gsap from 'gsap'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'

interface ProgressStep {
  id: string
  label: string
  detail?: string
  status: 'pending' | 'active' | 'done'
  // Game-specific metadata
  gameIndex?: number
  totalGames?: number
  opponentName?: string
  opponentAvatar?: string
  opponentRating?: number
  playerColor?: 'white' | 'black'
  result?: 'W' | 'L' | 'D'
  timeClass?: string
  // Step type for custom rendering
  stepType?: 'game' | 'fetch' | 'compute'
  minDuration?: number // ms to stay active before transitioning
}

export default function ProfileAnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [status, setStatus] = useState<'loading' | 'analyzing' | 'computing' | 'done' | 'error'>('loading')
  const [steps, setSteps] = useState<ProgressStep[]>([])
  const [result, setResult] = useState<ProfileAnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [username, setUsername] = useState<string>('')
  const [gamesRequested, setGamesRequested] = useState(10)
  const [analysisStartTime, setAnalysisStartTime] = useState<number | null>(null)
  const [profile, setProfile] = useState<{
    avatar: string; name: string; username: string; joined: string;
    title?: string; totalGames?: number;
    bullet?: number; blitz?: number; rapid?: number;
    peak?: { mode: string; rating: number };
    joinedTimestamp?: number;
  } | null>(null)
  const [profileReady, setProfileReady] = useState(false) // profile card animated and slid up
  const profileReadyRef = useRef(false)
  const [profilePhase, setProfilePhase] = useState<'skeleton' | 'reveal' | 'ratings' | 'slideUp' | 'done'>('skeleton')
  const wsRef = useRef<WebSocket | null>(null)
  const stepsContainerRef = useRef<HTMLDivElement>(null)
  const profileCardRef = useRef<HTMLDivElement>(null)
  const stepQueueRef = useRef<Array<{ done: ProgressStep; next: ProgressStep }>>([])
  const isAnimatingRef = useRef(false)
  const stepAddedAtRef = useRef<Map<string, number>>(new Map())
  const pendingMessagesRef = useRef<any[]>([]) // buffer WS messages until profile is ready
  const reportRef = useRef<HTMLDivElement>(null)

  const updateStep = useCallback((stepId: string, updates: Partial<ProgressStep>) => {
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, ...updates } : s))
  }, [])

  const addStep = useCallback((step: ProgressStep) => {
    stepAddedAtRef.current.set(step.id, Date.now())
    setSteps(prev => {
      const exists = prev.find(s => s.id === step.id)
      if (exists) return prev.map(s => s.id === step.id ? { ...s, ...step } : s)
      return [...prev, step]
    })
  }, [])

  // Show max 4 steps with progressive fade
  const MAX_VISIBLE_STEPS = 4
  const visibleSteps = steps.slice(-MAX_VISIBLE_STEPS)
  const prevStepsLengthRef = useRef(0)

  // Process queued transitions: wait minDuration, shine on done step, then add next step
  const processQueue = useCallback(() => {
    if (isAnimatingRef.current || stepQueueRef.current.length === 0) return
    isAnimatingRef.current = true

    const { done, next } = stepQueueRef.current.shift()!

    // Check how long the done step has been active
    const addedAt = stepAddedAtRef.current.get(done.id) || Date.now()
    const minDur = done.minDuration || 0
    const elapsed = Date.now() - addedAt
    const waitTime = Math.max(0, minDur - elapsed)

    setTimeout(() => {
      // Mark the old step as done
      setSteps(prev => prev.map(s => s.id === done.id ? { ...s, status: 'done' as const } : s))

      // Wait a tick for DOM update, then play shine
      requestAnimationFrame(() => {
        const container = stepsContainerRef.current
        const doneEl = container?.querySelector(`[data-step-id="${done.id}"]`)
        const shine = doneEl?.querySelector('.step-shine')
        const border = doneEl?.querySelector('.step-border')

        const addNext = () => {
          stepAddedAtRef.current.set(next.id, Date.now())
          setSteps(prev => {
            if (prev.find(s => s.id === next.id)) return prev
            return [...prev, next]
          })
          isAnimatingRef.current = false
          setTimeout(() => processQueue(), 50)
        }

        // Reset ALL borders to resting state before shining
        const allBorders = container?.querySelectorAll('.step-border')
        allBorders?.forEach(b => {
          gsap.killTweensOf(b)
          gsap.to(b, { opacity: 0.2, duration: 0.3 })
        })

        if (shine) {
          gsap.fromTo(shine,
            { x: '-100%', opacity: 0.8 },
            { x: '300%', opacity: 0, duration: 0.7, ease: 'power2.in', onComplete: addNext }
          )
          return
        }

        addNext()
      })
    }, waitTime)
  }, [])

  // Enqueue a transition: mark old step done + shine, then show new step
  const enqueueTransition = useCallback((doneStep: ProgressStep, nextStep: ProgressStep) => {
    stepQueueRef.current.push({ done: doneStep, next: nextStep })
    processQueue()
  }, [processQueue])

  // GSAP: animate new steps in + breathing border on active
  useEffect(() => {
    if (!stepsContainerRef.current) return
    const items = stepsContainerRef.current.querySelectorAll('.step-item')
    if (items.length === 0) return

    const isNewStep = steps.length > prevStepsLengthRef.current
    prevStepsLengthRef.current = steps.length

    if (isNewStep) {
      const lastItem = items[items.length - 1] as HTMLElement

      // New step unfolds: starts collapsed, expands to full height
      const fullHeight = lastItem.offsetHeight
      gsap.fromTo(lastItem,
        { maxHeight: 0 },
        { maxHeight: fullHeight + 10, duration: 0.45, ease: 'power3.out',
          onComplete: () => { gsap.set(lastItem, { clearProps: 'maxHeight' }) }
        }
      )
    }

    // Breathing border on the active (newest) step — subtle
    const newestItem = items[items.length - 1]
    const activeBorder = newestItem?.querySelector('.step-border')
    if (activeBorder && newestItem?.getAttribute('data-status') === 'active') {
      gsap.killTweensOf(activeBorder)
      gsap.fromTo(activeBorder,
        { opacity: 0.15 },
        { opacity: 0.5, duration: 1.2, repeat: -1, yoyo: true, ease: 'sine.inOut' }
      )
    }
  }, [steps])

  // Sequenced profile card animation
  useEffect(() => {
    if (!profile || !profileCardRef.current || profilePhase !== 'skeleton') return

    const card = profileCardRef.current
    const tl = gsap.timeline()

    // Phase 1: reveal avatar + name (hide skeletons, show real content)
    tl.to(card.querySelectorAll('.skeleton'), { opacity: 0, duration: 0.3, stagger: 0.05 })
    tl.call(() => setProfilePhase('reveal'))
    tl.fromTo(card.querySelector('.profile-avatar'), { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.5)' })
    tl.fromTo(card.querySelector('.profile-name'), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' }, '-=0.2')

    // Phase 2: joined at
    tl.fromTo(card.querySelector('.profile-joined'), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' }, '+=0.15')

    // Phase 3: ratings one by one, counter animation only on peak
    tl.call(() => setProfilePhase('ratings'))
    const badges = card.querySelectorAll('.rating-badge')
    badges.forEach((badge: Element, i: number) => {
      tl.fromTo(badge, { opacity: 0, y: 10, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: 'back.out(1.2)' }, i === 0 ? '+=0.2' : '-=0.15')
    })

    // Counter animation on peak rating
    const peakEl = card.querySelector('.peak-number') as HTMLElement
    const peakVisible = peakEl?.querySelector('span:last-child') as HTMLElement
    if (peakEl && peakVisible) {
      const target = parseInt(peakEl.dataset.value || '0')
      if (target > 0) {
        const counter = { value: 0 }
        tl.to(counter, {
          value: target,
          duration: 0.8,
          ease: 'power2.out',
          snap: { value: 1 },
          onUpdate: () => { peakVisible.textContent = Math.round(counter.value).toString() },
        }, '-=0.3')
      }
    }

    // Phase 4: pause, then mark ready (no slide)
    tl.call(() => {
      setProfilePhase('done')
      profileReadyRef.current = true
      setProfileReady(true)
    }, [], '+=0.6')

  }, [profile, profilePhase])

  // Flush buffered WS messages when profile animation completes
  const handleMessageRef = useRef<((msg: any) => void) | null>(null)

  useEffect(() => {
    if (!profileReady || !handleMessageRef.current) return
    const pending = pendingMessagesRef.current
    pendingMessagesRef.current = []
    for (const msg of pending) {
      handleMessageRef.current(msg)
    }
  }, [profileReady])

  // Animate report reveal
  useEffect(() => {
    if (status !== 'done' || !reportRef.current) return
    const sections = reportRef.current.querySelectorAll('.report-section')
    gsap.fromTo(sections, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out', delay: 0.2 })
  }, [status])

  useEffect(() => {
    let cancelled = false
    let joinedTs: number | undefined

    async function init() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        // Fetch analysis from API
        const res = await fetch(`/api/profile-analysis/${id}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        if (!data.analysis) { setError('Analysis not found'); setStatus('error'); return }

        const analysis = data.analysis
        const playerUsername = analysis.platform_username
        setUsername(playerUsername)
        setGamesRequested(analysis.games_requested || 10)

        // Fetch Chess.com profile
        try {
          const [profileRes, statsRes] = await Promise.all([
            fetch(`https://api.chess.com/pub/player/${playerUsername}`, { headers: { 'User-Agent': 'Chessr/1.0' } }),
            fetch(`https://api.chess.com/pub/player/${playerUsername}/stats`, { headers: { 'User-Agent': 'Chessr/1.0' } }),
          ])
          const profileData = await profileRes.json()
          const statsData = await statsRes.json()
          const countGames = (mode: any) => mode ? (mode.record?.win || 0) + (mode.record?.loss || 0) + (mode.record?.draw || 0) : 0
          const totalGames = countGames(statsData.chess_bullet) + countGames(statsData.chess_blitz) + countGames(statsData.chess_rapid)

          // Find peak rating across modes
          const peaks = [
            { mode: 'Bullet', rating: statsData.chess_bullet?.best?.rating },
            { mode: 'Blitz', rating: statsData.chess_blitz?.best?.rating },
            { mode: 'Rapid', rating: statsData.chess_rapid?.best?.rating },
          ].filter(p => p.rating != null)
          const peak = peaks.length > 0 ? peaks.reduce((a, b) => a.rating! > b.rating! ? a : b) : undefined

          setProfile({
            avatar: profileData.avatar || '',
            name: profileData.name || playerUsername,
            username: playerUsername,
            joined: profileData.joined ? new Date(profileData.joined * 1000).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '',
            title: profileData.title || undefined,
            totalGames: totalGames || undefined,
            bullet: statsData.chess_bullet?.last?.rating,
            blitz: statsData.chess_blitz?.last?.rating,
            rapid: statsData.chess_rapid?.last?.rating,
            peak: peak ? { mode: peak.mode, rating: peak.rating! } : undefined,
            joinedTimestamp: profileData.joined || undefined,
          })
          joinedTs = profileData.joined || undefined
        } catch { /* profile is optional */ }

        if (analysis.status === 'success' && analysis.games_data) {
          // Already completed — compute and show
          const dna = computePlayDNA(analysis.games_data, analysis.platform_username, { accountCreatedAt: joinedTs })
          setResult(dna)
          setStatus('done')
          return
        }

        if (analysis.status === 'error') {
          setError(analysis.error_message || 'Analysis failed')
          setStatus('error')
          return
        }

        // Start or subscribe to analysis via WebSocket
        setStatus('analyzing')
        setAnalysisStartTime(Date.now())

        const wsUrl = process.env.NEXT_PUBLIC_CHESSR_WS_URL || 'ws://localhost:8080'
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'auth', token: session.access_token, source: 'app' }))
        }

        ws.onmessage = (event) => {
          if (cancelled) return
          const msg = JSON.parse(event.data)

          if (msg.type === 'auth_success') {
            if (analysis.status === 'pending') {
              const modesConfig = analysis.modes_config
              ws.send(JSON.stringify({
                type: 'profile_analysis_start',
                platformUsername: analysis.platform_username,
                analysisId: id,
                gamesCount: analysis.games_requested || 10,
                ...(modesConfig ? { modes: modesConfig.modes, gamesPerMode: modesConfig.gamesPerMode } : {}),
              }))
            } else {
              ws.send(JSON.stringify({ type: 'profile_analysis_subscribe', analysisId: id }))
            }
            return
          }

          if (msg.type === 'profile_analysis_progress' || msg.type === 'profile_analysis_result') {
            const enriched = msg.type === 'profile_analysis_result'
              ? { ...msg, platformUsername: analysis.platform_username }
              : msg
            // Dispatch directly if profile animation is done, otherwise buffer
            if (profileReadyRef.current && handleMessageRef.current) {
              handleMessageRef.current(enriched)
            } else {
              pendingMessagesRef.current.push(enriched)
            }
            return
          }

          if (msg.type === 'profile_analysis_error') {
            setError(msg.error)
            setStatus('error')
            return
          }
        }

        ws.onerror = () => { if (!cancelled) { setError('Connection error'); setStatus('error') } }
        ws.onclose = () => { if (!cancelled && status === 'analyzing') { /* let it be, analysis continues server-side */ } }

      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : 'Unknown error'); setStatus('error') }
      }
    }

    const seenSteps = new Set<string>()
    let resultHandled = false

    function dispatchMessage(msg: any) {
      if (msg.type === 'profile_analysis_progress') {
        handleProgress(msg)
      } else if (msg.type === 'profile_analysis_result') {
        if (resultHandled) return
        resultHandled = true
        handleResult(msg.gamesData, msg.platformUsername || analysis?.platform_username)
      }
    }

    // Store ref so the flush useEffect can call it
    handleMessageRef.current = dispatchMessage

    let lastStepId = 'fetching' // tracks the last step for transition chaining

    function handleProgress(msg: any) {
      switch (msg.step) {
        case 'fetching_history':
          addStep({ id: 'fetching', label: 'Searching game history', status: 'active', stepType: 'fetch' })
          lastStepId = 'fetching'
          break
        case 'games_found':
          updateStep('fetching', { label: `Found ${msg.totalGames} games`, status: 'done' })
          break
        case 'games_found_by_mode': {
          const modesDetail = (msg.modes || []).map((m: any) => `${m.count} ${m.mode}`).join(', ')
          updateStep('fetching', { label: `Found ${modesDetail}`, status: 'done' })
          break
        }
        case 'mode_start': {
          const modeId = `mode-${msg.mode}`
          if (seenSteps.has(modeId)) break
          seenSteps.add(modeId)

          const modeStep: ProgressStep = {
            id: modeId,
            label: `${TC_LABELS[msg.mode] || msg.mode} — ${msg.gamesInMode} games`,
            timeClass: msg.mode,
            status: 'active',
            stepType: 'compute',
            minDuration: 600,
          }

          enqueueTransition({ id: lastStepId, label: '', status: 'done' }, modeStep)
          lastStepId = modeId
          break
        }
        case 'analyzing_game': {
          const gameId = `game-${msg.gameIndex}`
          if (seenSteps.has(gameId)) return
          seenSteps.add(gameId)

          // Use mode-aware label if available
          const label = msg.mode && msg.gameIndexInMode != null
            ? `Game ${msg.gameIndexInMode + 1}/${msg.gamesInMode}`
            : `Game ${(msg.gameIndex || 0) + 1}/${msg.totalGames}`

          const newStep: ProgressStep = {
            id: gameId,
            label,
            status: 'active',
            stepType: 'game',
            gameIndex: msg.gameIndex,
            totalGames: msg.totalGames,
            opponentName: msg.opponentName,
            opponentAvatar: msg.opponentAvatar,
            opponentRating: msg.opponentRating,
            playerColor: msg.playerColor,
            result: msg.result,
            timeClass: msg.timeClass || msg.mode,
          }

          enqueueTransition({ id: lastStepId, label: '', status: 'done' }, newStep)
          lastStepId = gameId
          break
        }
      }
    }

    function handleResult(gamesData: GameRawData[], platformUsername: string) {
      setStatus('computing')

      const fakeSteps: ProgressStep[] = [
        { id: 'dna', label: 'Computing player DNA', detail: 'Piece accuracy, phase balance, style detection', status: 'active', minDuration: 1300, stepType: 'compute' },
        { id: 'tempo', label: 'Analyzing reaction times', detail: 'Think time patterns, critical vs calm positions', status: 'active', minDuration: 1000, stepType: 'compute' },
        { id: 'report', label: 'Generating anti-cheat report', detail: 'Consistency checks, human score calculation', status: 'active', minDuration: 2000, stepType: 'compute' },
        { id: 'complete', label: 'Analysis completed', status: 'active', minDuration: 2000, stepType: 'compute' },
      ]

      // Get last active step and queue the chain
      setSteps(prev => {
        const lastActive = [...prev].reverse().find(s => s.status === 'active')
        const lastId = lastActive?.id || prev[prev.length - 1]?.id

        // Chain: last game → dna → tempo → report → complete
        if (lastId) {
          enqueueTransition({ id: lastId, label: '', status: 'done' }, fakeSteps[0])
        }
        for (let i = 1; i < fakeSteps.length; i++) {
          enqueueTransition(
            { id: fakeSteps[i - 1].id, label: '', status: 'done', minDuration: fakeSteps[i - 1].minDuration },
            fakeSteps[i]
          )
        }

        return prev
      })

      // Watch for 'complete' step to appear, wait its minDuration, then show result
      const checkDone = setInterval(() => {
        setSteps(prev => {
          const completeStep = prev.find(s => s.id === 'complete')
          if (completeStep) {
            clearInterval(checkDone)
            const addedAt = stepAddedAtRef.current.get('complete') || Date.now()
            const elapsed = Date.now() - addedAt
            const wait = Math.max(0, 2000 - elapsed)
            setTimeout(() => {
              const dna = computePlayDNA(gamesData, platformUsername, { accountCreatedAt: joinedTs })
              setResult(dna)
              setStatus('done')
            }, wait)
          }
          return prev
        })
      }, 200)
    }

    init()

    return () => {
      cancelled = true
      wsRef.current?.close()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <>
      {/* Animated background blobs */}
      <main className="relative z-10 max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <Link href="/profile-analysis" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ChevronLeft className="w-4 h-4" /> Back to analyses
        </Link>

      {status === 'loading' && (
        <div className="flex items-center justify-center py-20">
          <svg className="material-spinner w-8 h-8 opacity-50" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg">
            <circle className="spinner-path" fill="none" strokeWidth="5" strokeLinecap="round" cx="33" cy="33" r="30" />
          </svg>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center py-20">
          <AlertTriangle className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Analysis Failed</h2>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Link href="/profile-analysis">
            <Button variant="outline">Back to Profile Analysis</Button>
          </Link>
        </div>
      )}

      {(status === 'analyzing' || status === 'computing') && (
        <div className="max-w-lg mx-auto py-4 sm:py-8">
          {/* Profile card — centered initially, slides up when ready */}
          <div
            ref={profileCardRef}
            className={`rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm p-4 sm:p-5 ${!profileReady ? 'min-h-[120px] sm:min-h-[140px] flex flex-col justify-center' : ''}`}
          >
            {/* Skeleton state */}
            {profilePhase === 'skeleton' && !profile && (
              <div className="flex items-center gap-4">
                <div className="skeleton w-14 h-14 rounded-xl bg-muted animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-32 bg-muted rounded animate-pulse" />
                  <div className="skeleton h-3.5 w-48 bg-muted/60 rounded animate-pulse" />
                </div>
              </div>
            )}

            {/* Real content — hidden initially, revealed by GSAP */}
            {profile && (
              <>
                <div className="flex items-center gap-4">
                  {profile.avatar ? (
                    <img src={profile.avatar} alt={profile.username} className="profile-avatar w-14 h-14 rounded-xl border-2 border-border/40 opacity-0" />
                  ) : (
                    <div className="profile-avatar w-14 h-14 rounded-xl bg-muted flex items-center justify-center text-xl font-bold text-muted-foreground opacity-0">
                      {profile.username[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="profile-name flex items-center gap-2 opacity-0">
                      {profile.title && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">{profile.title}</span>
                      )}
                      <h2 className="text-lg font-bold truncate">{profile.username}</h2>
                    </div>
                    <div className="profile-joined text-sm text-muted-foreground opacity-0">
                      {profile.joined && <span>Joined {profile.joined}</span>}
                      {profile.totalGames != null && (
                        <><span className="text-border"> · </span><span>{profile.totalGames.toLocaleString()} games</span></>
                      )}
                    </div>
                  </div>
                  <Shield className="profile-avatar w-8 h-8 text-primary shrink-0 opacity-0" />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3 sm:mt-4">
                  {profile.bullet != null && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 border border-border/30 opacity-0">
                      <TcIcon tc="bullet" className="w-3.5 h-3.5" colored />
                      <span className="text-xs sm:text-sm font-semibold">{profile.bullet}</span>
                    </div>
                  )}
                  {profile.blitz != null && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 border border-border/30 opacity-0">
                      <TcIcon tc="blitz" className="w-3.5 h-3.5" colored />
                      <span className="text-xs sm:text-sm font-semibold">{profile.blitz}</span>
                    </div>
                  )}
                  {profile.rapid != null && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 border border-border/30 opacity-0">
                      <TcIcon tc="rapid" className="w-3.5 h-3.5" colored />
                      <span className="text-xs sm:text-sm font-semibold">{profile.rapid}</span>
                    </div>
                  )}
                  {profile.peak && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 opacity-0">
                      <Crown className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs text-amber-400">Peak</span>
                      <span className="peak-number text-xs sm:text-sm font-semibold text-amber-300 relative inline-block" data-value={profile.peak.rating}>
                        <span className="invisible">{profile.peak.rating}</span>
                        <span className="absolute inset-0 text-right">0</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{profile.peak.mode}</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Steps — only show after profile has slid up */}
          {profileReady && (
            <>
              <div
                ref={stepsContainerRef}
                className="gap-3 flex flex-col justify-end overflow-hidden"
                style={{
                  height: '300px',
                  maskImage: 'linear-gradient(transparent 0%, rgba(0,0,0,0.15) 15%, rgba(0,0,0,0.5) 45%, black 55%)',
                  WebkitMaskImage: 'linear-gradient(transparent 0%, rgba(0,0,0,0.15) 15%, rgba(0,0,0,0.5) 45%, black 55%)',
                }}
              >
                {visibleSteps.filter(s => s.id !== '_done').map((step) => (
                  <StepCard key={step.id} step={step} />
                ))}
              </div>
              {!steps.find(s => s.id === 'complete') && (
                <EstimatedTime gamesCount={gamesRequested} startTime={analysisStartTime} />
              )}
            </>
          )}
        </div>
      )}

      {status === 'done' && result && (
        <div ref={reportRef}>
          <AnalysisReport result={result} profile={profile} />
        </div>
      )}
    </main>
    </>
  )
}

// ─── Step Card (memoized to prevent re-renders of old cards) ───

const COMPUTE_ICONS: Record<string, React.ReactNode> = {
  dna: <Dna className="w-4 h-4" />,
  tempo: <Timer className="w-4 h-4" />,
  report: <ShieldCheck className="w-4 h-4" />,
  complete: <Flag className="w-4 h-4" />,
  fetching: <Search className="w-4 h-4" />,
}

const Spinner = () => (
  <svg className="material-spinner w-4 h-4 sm:w-5 sm:h-5 shrink-0 opacity-80" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg">
    <circle className="spinner-path" fill="none" strokeWidth="6" strokeLinecap="round" cx="33" cy="33" r="30" />
  </svg>
)

// TC icons handled by TcIcon component

const StepCard = memo(function StepCard({ step }: { step: ProgressStep }) {
  const isActive = step.status === 'active'
  const isDone = step.status === 'done'
  const isGame = step.stepType === 'game'

  return (
    <div
      data-step-id={step.id}
      data-status={step.status}
      className="step-item relative rounded-xl overflow-hidden"
    >
      <div
        className="step-border absolute inset-0 rounded-xl pointer-events-none"
        style={{ border: '1px solid rgba(255,255,255,0.12)', opacity: 0.2 }}
      />
      <div
        className="step-shine absolute inset-0 pointer-events-none opacity-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 40%, rgba(255,255,255,0.08) 60%, transparent 100%)',
          width: '40%',
        }}
      />

      {isGame ? (
        /* ─── Game card ─── */
        <div className="relative flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:py-4 bg-card/50">
          {/* Spinner or check */}
          <div className="shrink-0">
            {isDone ? <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" /> : isActive ? <Spinner /> : null}
          </div>

          {/* Game counter */}
          <span className="text-xs sm:text-sm text-muted-foreground font-medium shrink-0">
            {step.label}
          </span>

          {/* Separator */}
          <div className="w-px h-4 sm:h-5 bg-border/40 shrink-0" />

          {/* Opponent info */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            {step.opponentAvatar && (
              <img src={step.opponentAvatar} alt="" className="w-5 h-5 sm:w-6 sm:h-6 rounded-md shrink-0" />
            )}
            <span className={`text-xs sm:text-sm font-medium truncate ${isDone ? 'text-muted-foreground' : 'text-foreground'}`}>
              {step.opponentName}
            </span>
            {step.opponentRating && (
              <span className="text-xs text-muted-foreground shrink-0">({step.opponentRating})</span>
            )}
          </div>

          {/* Right side: color + result + time class */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {step.timeClass && (
              <TcIcon tc={step.timeClass} className="w-4 h-4" colored />
            )}
            {step.playerColor && (
              <div className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-sm border ${step.playerColor === 'white' ? 'bg-white border-white/30' : 'bg-zinc-800 border-zinc-600'}`} />
            )}
            {step.result && (
              <span className={`text-xs font-bold ${step.result === 'W' ? 'text-emerald-400' : step.result === 'L' ? 'text-rose-400' : 'text-muted-foreground'}`}>
                {step.result === 'W' ? 'WIN' : step.result === 'L' ? 'LOSS' : 'DRAW'}
              </span>
            )}
          </div>
        </div>
      ) : (
        /* ─── Compute / fetch card ─── */
        <div className="relative flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 sm:py-4 bg-card/50">
          <div className="shrink-0">
            {step.id === 'complete' ? (
              <Flag className="w-5 h-5 text-emerald-400" />
            ) : isDone ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : isActive ? (
              <Spinner />
            ) : null}
          </div>

          {step.id !== 'complete' && (
            <div className={`shrink-0 ${isDone ? 'text-muted-foreground/50' : 'text-primary/70'}`}>
              {COMPUTE_ICONS[step.id] || null}
            </div>
          )}

          <div className="min-w-0">
            <span className={`text-sm font-medium ${isDone ? 'text-muted-foreground' : 'text-foreground'}`}>
              {step.label}
            </span>
            {step.detail && (
              <p className={`text-xs mt-0.5 ${isDone ? 'text-muted-foreground/40' : 'text-muted-foreground'}`}>
                {step.detail}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.step.id === next.step.id &&
  prev.step.status === next.step.status &&
  prev.step.label === next.step.label
)

// ─── Report Display (Gamified) ───

type ProfileInfo = {
  avatar: string; name: string; username: string; joined: string;
  title?: string; totalGames?: number;
  bullet?: number; blitz?: number; rapid?: number;
  peak?: { mode: string; rating: number };
  joinedTimestamp?: number;
}

function AnalysisReport({ result, profile }: { result: ProfileAnalysisResult; profile: ProfileInfo | null }) {
  const mainCadence = result.cadences[0]
  const winRate = result.gamesCount > 0 ? Math.round((result.wins / result.gamesCount) * 100) : 0

  // Fetch opponent avatars
  const [opponentAvatars, setOpponentAvatars] = useState<Record<string, string>>({})
  useEffect(() => {
    const uniqueNames = [...new Set(result.cadences.flatMap(c => c.games.map(g => g.opponentName)))]
    const fetchAvatars = async () => {
      const avatars: Record<string, string> = {}
      await Promise.allSettled(
        uniqueNames.map(async (name) => {
          try {
            const res = await fetch(`https://api.chess.com/pub/player/${name}`, { headers: { 'User-Agent': 'Chessr/1.0' } })
            if (res.ok) {
              const data = await res.json()
              if (data.avatar) avatars[name] = data.avatar
            }
          } catch { /* skip */ }
        })
      )
      setOpponentAvatars(avatars)
    }
    fetchAvatars()
  }, [result])

  return (
    <div className="space-y-6">
      {/* ── Hero: Profile + Score Ring + Quick Stats ── */}
      <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-8">
        <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-10">
          {/* Left — Profile */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-4 mb-4">
              {profile?.avatar ? (
                <img src={profile.avatar} alt={result.username} className="w-16 h-16 rounded-2xl border-2 border-border/40" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center text-2xl font-bold text-muted-foreground">
                  {result.username[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {profile?.title && (
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30">{profile.title}</span>
                  )}
                  <h1 className="text-xl font-bold truncate">{result.username}</h1>
                </div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {profile?.joined && <span>Joined {profile.joined}</span>}
                  {profile?.totalGames != null && <><span className="text-border"> · </span><span>{profile.totalGames.toLocaleString()} games</span></>}
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

            {/* Quick stats row */}
            <div className="grid grid-cols-4 gap-3 mt-2">
              <QuickStat icon={<Swords className="w-4 h-4" />} value={`${result.gamesCount}`} label="games" />
              <QuickStat icon={<TrendingUp className="w-4 h-4 text-emerald-400" />} value={`${winRate}%`} label="win rate" color="text-emerald-400" />
              <QuickStat icon={<Target className="w-4 h-4 text-sky-400" />} value={`${mainCadence?.avgAccuracy?.toFixed(1) ?? '-'}%`} label="accuracy" color="text-sky-400" />
              <QuickStat icon={<Zap className="w-4 h-4 text-amber-400" />} value={`${mainCadence?.bestMoveRate.toFixed(0) ?? '-'}%`} label="best moves" color="text-amber-400" />
            </div>
          </div>

          {/* Right — Human Score Ring */}
          {mainCadence && (() => {
            const hs = combinedHumanScore(mainCadence.flags, mainCadence.antiCheat.checks)
            const risk: string = hs >= 7 ? 'LOW' : hs >= 4 ? 'MEDIUM' : 'HIGH'
            return (
              <div className="flex flex-col items-center gap-2 shrink-0">
                <ScoreRing score={hs} maxScore={10} riskLevel={risk} size={140} />
                <span className="text-xs text-muted-foreground">Human Score</span>
              </div>
            )
          })()}
        </div>

        {/* W/L/D Bar */}
        <div className="mt-5">
          <WinLossBar wins={result.wins} losses={result.losses} draws={result.draws} />
        </div>
      </div>

      {/* Per cadence */}
      {result.cadences.map((cadence) => (
        <CadenceSection key={cadence.tcType} cadence={cadence} opponentAvatars={opponentAvatars} />
      ))}
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

function QuickStat({ icon, value, label, color }: { icon: React.ReactNode; value: string; label: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 px-1 rounded-xl bg-muted/30 border border-border/20">
      {icon}
      <span className={`text-lg font-bold leading-none ${color || ''}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  )
}

function ScoreRing({ score, maxScore, riskLevel, size = 140 }: { score: number; maxScore: number; riskLevel: string; size?: number }) {
  const strokeWidth = 8
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = (score / maxScore) * circumference
  const color = riskLevel === 'LOW' ? '#34d399' : riskLevel === 'MEDIUM' ? '#fbbf24' : '#f87171'
  const bgColor = riskLevel === 'LOW' ? 'rgba(52,211,153,0.1)' : riskLevel === 'MEDIUM' ? 'rgba(251,191,36,0.1)' : 'rgba(248,113,113,0.1)'
  const label = riskLevel === 'LOW' ? 'Legit' : riskLevel === 'MEDIUM' ? 'Suspicious' : 'Flagged'

  return (
    <div className="relative" style={{ width: size, height: size }}>
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
        <span className="text-3xl font-black leading-none" style={{ color }}>{score % 1 === 0 ? score : score.toFixed(1)}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">/ {maxScore}</span>
        <span className="text-xs font-semibold mt-1 px-2 py-0.5 rounded-full" style={{ color, backgroundColor: bgColor }}>
          {label}
        </span>
      </div>
    </div>
  )
}

function WinLossBar({ wins, losses, draws }: { wins: number; losses: number; draws: number }) {
  const total = wins + losses + draws
  if (total === 0) return null
  const wp = (wins / total) * 100
  const dp = (draws / total) * 100
  const lp = (losses / total) * 100

  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
        {wp > 0 && <div className="bg-emerald-400 rounded-l-full" style={{ width: `${wp}%` }} />}
        {dp > 0 && <div className="bg-zinc-500" style={{ width: `${dp}%` }} />}
        {lp > 0 && <div className="bg-rose-400 rounded-r-full" style={{ width: `${lp}%` }} />}
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
        <span className="text-emerald-400 font-medium">{wins}W</span>
        {draws > 0 && <span>{draws}D</span>}
        <span className="text-rose-400 font-medium">{losses}L</span>
      </div>
    </div>
  )
}

// ─── Cadence Section (Per time control) ───

function CadenceSection({ cadence, opponentAvatars }: { cadence: ReturnType<typeof computePlayDNA>['cadences'][number]; opponentAvatars: Record<string, string> }) {
  const c = cadence
  // Radar data for piece DNA
  const radarData = c.pieces.map(p => ({
    piece: p.label,
    value: p.mean,
    fullMark: 100,
  }))

  // Move quality distribution
  const moveCategories = [
    { key: 'brilliant', label: 'Brilliant', color: '#00e5ff', icon: '💎' },
    { key: 'great', label: 'Great', color: '#8b5cf6', icon: '🔮' },
    { key: 'best', label: 'Best', color: '#34d399', icon: '✦' },
    { key: 'excellent', label: 'Excellent', color: '#22d3ee', icon: '✧' },
    { key: 'good', label: 'Good', color: '#a3e635', icon: '' },
    { key: 'book', label: 'Book', color: '#94a3b8', icon: '📖' },
    { key: 'inaccuracy', label: 'Inaccuracy', color: '#fbbf24', icon: '' },
    { key: 'mistake', label: 'Mistake', color: '#f97316', icon: '' },
    { key: 'miss', label: 'Miss', color: '#ef4444', icon: '' },
    { key: 'blunder', label: 'Blunder', color: '#dc2626', icon: '' },
  ]

  const totalClassified = Object.values(c.classifications).reduce((a, b) => a + b, 0) || 1

  return (
    <>
      {/* ── Style Banner ── */}
      <div className="report-section rounded-2xl border border-border/60 bg-gradient-to-r from-primary/5 via-card/50 to-card/50 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">{c.tcLabel} Profile</h2>
            <p className="text-sm text-primary font-medium">{c.style}</p>
          </div>
          <div className="ml-auto">
            <SectionScore score={profileFlagScore(c.flags)} max={profileFlagMax(c.flags)} />
          </div>
        </div>

        {/* Key metrics as visual cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {c.flags.map(f => (
            <MetricCard
              key={f.id}
              icon={FLAG_ICONS[f.id] || <Shield className="w-4 h-4" />}
              label={f.label}
              value={f.value}
              sub={f.detail}
              flag={f.status}
            />
          ))}
        </div>
      </div>

      {/* ── Piece DNA (Radar) + Phase Balance ── */}
      <div className="report-section grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Piece DNA Radar */}
        <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-2">
            <Dna className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Piece DNA</h3>
          </div>
          <div className="h-[220px] -mx-4" style={{ minWidth: 200, minHeight: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis
                  dataKey="piece"
                  tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                />
                <Radar
                  dataKey="value"
                  stroke="#38bdf8"
                  fill="#38bdf8"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
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
              <span className="text-rose-400">
                Weakest: {c.weakestPiece.label} ({c.weakestPiece.mean.toFixed(0)}%)
              </span>
            )}
          </div>
        </div>

        {/* Phase Balance */}
        <div className="rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Swords className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">Game Phases</h3>
          </div>
          <div className="space-y-4">
            {c.phases.map((p) => {
              const isBest = p.phase === c.bestPhase?.phase
              const isWorst = p.phase === c.worstPhase?.phase
              const color = isBest ? 'bg-emerald-400' : isWorst ? 'bg-rose-400' : 'bg-violet-400'
              const textColor = isBest ? 'text-emerald-400' : isWorst ? 'text-rose-400' : 'text-violet-400'
              return (
                <div key={p.phase}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      {p.label}
                      {isBest && <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-1.5 py-0.5 rounded-full font-semibold">BEST</span>}
                      {isWorst && <span className="text-[10px] text-rose-400 bg-rose-400/10 px-1.5 py-0.5 rounded-full font-semibold">WEAKEST</span>}
                    </span>
                    <span className={`text-sm font-bold ${textColor}`}>{p.mean.toFixed(1)}%</span>
                  </div>
                  <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${Math.min(100, p.mean)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Move Quality Distribution ── */}
      <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Move Quality</h3>
          <span className="text-xs text-muted-foreground ml-auto">{c.totalMoves} moves analyzed</span>
        </div>
        {/* Stacked bar */}
        <div className="flex h-8 rounded-xl overflow-hidden gap-px">
          {moveCategories.map(cat => {
            const count = c.classifications[cat.key] || 0
            const pct = (count / totalClassified) * 100
            if (pct < 0.5) return null
            return (
              <div
                key={cat.key}
                className="relative group flex items-center justify-center transition-all hover:brightness-110"
                style={{ width: `${pct}%`, backgroundColor: cat.color }}
                title={`${cat.label}: ${count} (${pct.toFixed(1)}%)`}
              >
                {pct > 6 && <span className="text-[10px] font-bold text-black/70">{Math.round(pct)}%</span>}
              </div>
            )
          })}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {moveCategories.map(cat => {
            const count = c.classifications[cat.key] || 0
            if (count === 0) return null
            return (
              <div key={cat.key} className="flex items-center gap-1.5 text-xs">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cat.color }} />
                <span className="text-muted-foreground">{cat.label}</span>
                <span className="font-medium">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Anti-Cheat ── */}
      <div className="report-section rounded-2xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Fair Play Analysis</h3>
          <div className="ml-auto">
            <SectionScore score={fairPlayScore(c.antiCheat.checks)} max={c.antiCheat.checks.length} />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {c.antiCheat.checks.map((check, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${
              check.status === 'PASS' ? 'bg-emerald-500/5 border-emerald-500/15' :
              check.status === 'WARN' ? 'bg-amber-500/5 border-amber-500/15' :
              'bg-rose-500/5 border-rose-500/15'
            }`}>
              <span className="shrink-0">
                {check.status === 'PASS' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> :
                 check.status === 'WARN' ? <CircleAlert className="w-4 h-4 text-amber-400" /> :
                 <XCircle className="w-4 h-4 text-rose-400" />}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{ANTICHEAT_LABELS[check.label] || check.label.replace(/_/g, ' ')}</div>
                <div className="text-[10px] text-muted-foreground truncate">{check.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Game Log ── */}
      <div className="report-section">
        <div className="flex items-center gap-2 mb-4">
          <Flag className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold uppercase tracking-wider">Game Log</h3>
          <span className="text-xs text-muted-foreground">{c.games.length} games</span>
        </div>
        <div className="space-y-2">
          {c.games.map((g, i) => (
            <GameCard key={g.gameId} game={g} index={i} avatar={opponentAvatars[g.opponentName]} />
          ))}
        </div>
      </div>
    </>
  )
}

// ─── Helpers ───

const ANTICHEAT_LABELS: Record<string, string> = {
  accuracy_delta: 'Accuracy',
  accuracy_consistency: 'Consistency',
  best_move_rate: 'Best Moves',
  piece_uniformity: 'Piece Balance',
  phase_uniformity: 'Phase Balance',
  think_reflex_ratio: 'Think Time',
  time_rhythm: 'Time Rhythm',
  has_mistakes: 'Mistakes',
}

// Score badge for a section: shows X/max
function SectionScore({ score, max }: { score: number; max: number }) {
  const pct = max > 0 ? score / max : 0
  const color = pct >= 0.7 ? 'text-emerald-400' : pct >= 0.4 ? 'text-amber-400' : 'text-rose-400'
  const bg = pct >= 0.7 ? 'bg-emerald-500/10 border-emerald-500/20' : pct >= 0.4 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-rose-500/10 border-rose-500/20'
  const displayScore = score % 1 === 0 ? score : score.toFixed(1)
  const displayMax = max % 1 === 0 ? max : max.toFixed(1)

  return (
    <div className={`flex items-baseline gap-0.5 px-3 py-2 rounded-xl border ${bg}`}>
      <span className={`text-xl font-black leading-none ${color}`}>{displayScore}</span>
      <span className="text-xs text-muted-foreground">/{displayMax}</span>
    </div>
  )
}

const FLAG_PTS: Record<string, number> = { clean: 1, suspicious: 0.5, flagged: -0.5 }
const CHECK_PTS: Record<string, number> = { PASS: 1, WARN: 0.5, FAIL: -0.5 }

function profileFlagScore(flags: { status: string; weight?: number }[]): number {
  return Math.max(0, flags.reduce((sum, f) => sum + (FLAG_PTS[f.status] ?? 0) * (f.weight ?? 1), 0))
}

function profileFlagMax(flags: { weight?: number }[]): number {
  return flags.reduce((sum, f) => sum + (f.weight ?? 1), 0)
}

function fairPlayScore(checks: { status: string }[]): number {
  return Math.max(0, checks.reduce((sum, c) => sum + (CHECK_PTS[c.status] ?? 0), 0))
}

function sectionScoreNormalized(score: number, max: number): number {
  return max > 0 ? Math.max(0, Math.round((score / max) * 100) / 10) : 0
}

function combinedHumanScore(flags: { status: string; weight?: number }[], checks: { status: string }[]): number {
  const profileNorm = sectionScoreNormalized(profileFlagScore(flags), profileFlagMax(flags))
  const fairPlayNorm = sectionScoreNormalized(fairPlayScore(checks), checks.length)
  return Math.max(0, Math.round(((profileNorm + fairPlayNorm) / 2) * 10) / 10)
}

const FLAG_ICONS: Record<string, React.ReactNode> = {
  accuracy: <Target className="w-4 h-4" />,
  bestMoves: <Flame className="w-4 h-4" />,
  blunders: <AlertTriangle className="w-4 h-4" />,
  focus: <Timer className="w-4 h-4" />,
  timeEntropy: <Clock className="w-4 h-4" />,
  winRate: <Crown className="w-4 h-4" />,
  accountAge: <Shield className="w-4 h-4" />,
}

function MetricCard({ icon, label, value, sub, flag = 'clean' }: {
  icon: React.ReactNode; label: string; value: string; sub: string; flag?: 'clean' | 'suspicious' | 'flagged'
}) {
  const styles = flag === 'flagged'
    ? 'bg-rose-500/5 border-rose-500/20'
    : flag === 'suspicious'
    ? 'bg-amber-500/5 border-amber-500/20'
    : 'bg-muted/20 border-border/30'

  return (
    <div className={`rounded-xl border p-3 ${styles}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        {flag === 'flagged' && <CircleAlert className="w-3 h-3 text-rose-400 ml-auto" />}
        {flag === 'suspicious' && <CircleAlert className="w-3 h-3 text-amber-400 ml-auto" />}
      </div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className={`text-[10px] mt-0.5 ${flag !== 'clean' ? (flag === 'flagged' ? 'text-rose-400/80' : 'text-amber-400/80') : 'text-muted-foreground'}`}>{sub}</div>
    </div>
  )
}

// ─── Game Card (always visible, per-game analysis) ───

const GAME_MOVE_CATS = [
  { key: 'brilliant', color: '#00e5ff' },
  { key: 'great', color: '#8b5cf6' },
  { key: 'best', color: '#34d399' },
  { key: 'excellent', color: '#22d3ee' },
  { key: 'good', color: '#a3e635' },
  { key: 'book', color: '#94a3b8' },
  { key: 'inaccuracy', color: '#fbbf24' },
  { key: 'mistake', color: '#f97316' },
  { key: 'miss', color: '#ef4444' },
  { key: 'blunder', color: '#dc2626' },
]

const PIECE_ICONS: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙' }

function focusLabel(ratio: number | null): string {
  if (ratio == null) return '-'
  if (ratio >= 1.5) return 'High'
  if (ratio >= 1.1) return 'Normal'
  if (ratio >= 0.9) return 'Low'
  return 'Flat'
}

function focusSub(ratio: number | null): string {
  if (ratio == null) return 'no data'
  if (ratio >= 1.5) return 'slows down on hard moves'
  if (ratio >= 1.1) return 'thinks a bit more on hard moves'
  if (ratio >= 0.9) return 'same speed everywhere'
  return 'faster on hard moves'
}

function accColorClass(acc: number | null): string {
  if (acc == null) return 'text-muted-foreground'
  if (acc >= 90) return 'text-emerald-400'
  if (acc >= 75) return 'text-sky-400'
  if (acc >= 60) return 'text-amber-400'
  return 'text-rose-400'
}

function GameCard({ game: g, index: i, avatar }: { game: ReturnType<typeof computePlayDNA>['cadences'][number]['games'][number]; index: number; avatar?: string }) {
  const isWin = g.result === 'W'
  const isLoss = g.result === 'L'
  const resultBg = isWin ? 'bg-emerald-500/10' : isLoss ? 'bg-rose-500/10' : 'bg-muted/30'
  const resultText = isWin ? 'text-emerald-400' : isLoss ? 'text-rose-400' : 'text-muted-foreground'
  const totalCls = Object.values(g.classifications).reduce((a, b) => a + b, 0) || 1

  return (
    <div className="rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm p-3 sm:p-4">
      {/* Header: avatar + opponent + accuracy + result */}
      <div className="flex items-center gap-3">
        {/* vs + opponent avatar */}
        <span className="text-[10px] text-muted-foreground/60 font-semibold uppercase shrink-0">vs</span>
        {avatar ? (
          <img src={avatar} alt={g.opponentName} className="shrink-0 w-9 h-9 rounded-lg object-cover" />
        ) : (
          <div className={`shrink-0 w-9 h-9 rounded-lg ${resultBg} flex items-center justify-center`}>
            <span className="text-sm font-bold text-muted-foreground">{g.opponentName[0]?.toUpperCase()}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{g.opponentName}</span>
            <span className="text-xs text-muted-foreground">({g.opponentRating})</span>
          </div>
        </div>

        {/* Accuracy */}
        <div className="text-right shrink-0">
          <span className={`text-lg font-bold ${accColorClass(g.accuracy)}`}>{g.accuracy?.toFixed(1) ?? '-'}%</span>
        </div>

        {/* Result badge */}
        <div className={`shrink-0 w-10 h-7 rounded-md ${resultBg} flex items-center justify-center`}>
          <span className={`text-xs font-black ${resultText}`}>
            {isWin ? 'WIN' : isLoss ? 'LOSS' : 'DRAW'}
          </span>
        </div>
      </div>

      {/* Body: phases + move quality bar + pieces — all inline */}
      <div className="mt-3 flex flex-col gap-2">
        {/* Row 1: Phase accuracy + piece accuracy */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Phases */}
          {[
            { label: 'Opening', emoji: '📖', value: g.opening },
            { label: 'Middlegame', emoji: '⚔️', value: g.middlegame },
            { label: 'Endgame', emoji: '🏁', value: g.endgame },
          ].map(p => p.value != null ? (
            <span key={p.label} className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-muted/40 flex items-center gap-1`} title={`${p.label} accuracy: ${p.value.toFixed(1)}%`}>
              <span className="text-muted-foreground">{p.label}</span>
              <span className={`font-bold ${accColorClass(p.value)}`}>{p.value.toFixed(0)}%</span>
            </span>
          ) : null)}

          {/* Separator */}
          {g.pieces.some(p => p.accuracy != null) && <div className="w-px h-4 bg-border/30 mx-0.5" />}

          {/* Pieces */}
          {g.pieces.filter(p => p.accuracy != null).map(p => (
            <span key={p.piece} className={`text-[11px] font-semibold px-1 py-0.5 rounded-md bg-muted/30 ${accColorClass(p.accuracy)}`} title={`${p.label} accuracy: ${p.accuracy!.toFixed(1)}%`}>
              {PIECE_ICONS[p.piece]}{p.accuracy!.toFixed(0)}
            </span>
          ))}
        </div>

        {/* Row 2: Move quality mini bar */}
        {g.totalMoves > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
            {GAME_MOVE_CATS.map(cat => {
              const count = g.classifications[cat.key] || 0
              const pct = (count / totalCls) * 100
              if (pct < 0.5) return null
              return (
                <div
                  key={cat.key}
                  style={{ width: `${pct}%`, backgroundColor: cat.color }}
                  title={`${cat.key}: ${count}`}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ~8s per game analysis + ~6s compute steps
const SECONDS_PER_GAME = 8
const COMPUTE_OVERHEAD = 6

function EstimatedTime({ gamesCount, startTime }: { gamesCount: number; startTime: number | null }) {
  const [remaining, setRemaining] = useState<number | null>(null)
  const totalEstimate = gamesCount * SECONDS_PER_GAME + COMPUTE_OVERHEAD

  useEffect(() => {
    if (!startTime) { setRemaining(totalEstimate); return }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setRemaining(Math.max(0, totalEstimate - elapsed))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startTime, totalEstimate])

  if (remaining == null) return null

  const display = remaining >= 60
    ? `~${Math.ceil(remaining / 60)} min`
    : `~${remaining}s`

  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground mt-3">
      <Clock className="w-3 h-3" />
      <span>Estimated time: {display}</span>
    </div>
  )
}
