'use client'

import { useEffect, useState, useRef, useCallback, use, memo } from 'react'
import { supabase } from '@/lib/supabase'
import { computePlayDNA, type GameRawData, type ProfileAnalysisResult } from '@/lib/play-dna'
import { CheckCircle2, Shield, AlertTriangle, ChevronLeft, Search, Dna, Timer, ShieldCheck, Flag, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import gsap from 'gsap'

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
          })
        } catch { /* profile is optional */ }

        if (analysis.status === 'success' && analysis.games_data) {
          // Already completed — compute and show
          const dna = computePlayDNA(analysis.games_data, analysis.platform_username)
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
          ws.send(JSON.stringify({ type: 'auth', token: session.access_token }))
        }

        ws.onmessage = (event) => {
          if (cancelled) return
          const msg = JSON.parse(event.data)

          if (msg.type === 'auth_success') {
            if (analysis.status === 'pending') {
              ws.send(JSON.stringify({
                type: 'profile_analysis_start',
                platformUsername: analysis.platform_username,
                analysisId: id,
                gamesCount: analysis.games_requested || 10,
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

    function handleProgress(msg: any) {
      switch (msg.step) {
        case 'fetching_history':
          addStep({ id: 'fetching', label: 'Searching game history', status: 'active', stepType: 'fetch' })
          break
        case 'games_found':
          updateStep('fetching', { label: `Found ${msg.totalGames} games`, status: 'done' })
          break
        case 'analyzing_game': {
          const gameId = `game-${msg.gameIndex}`
          if (seenSteps.has(gameId)) return
          seenSteps.add(gameId)

          const newStep: ProgressStep = {
            id: gameId,
            label: `Game ${(msg.gameIndex || 0) + 1}/${msg.totalGames}`,
            status: 'active',
            stepType: 'game',
            gameIndex: msg.gameIndex,
            totalGames: msg.totalGames,
            opponentName: msg.opponentName,
            opponentAvatar: msg.opponentAvatar,
            opponentRating: msg.opponentRating,
            playerColor: msg.playerColor,
            result: msg.result,
            timeClass: msg.timeClass,
          }

          const prevId = msg.gameIndex === 0 ? 'fetching' : `game-${msg.gameIndex - 1}`
          enqueueTransition({ id: prevId, label: '', status: 'done' }, newStep)
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
              const dna = computePlayDNA(gamesData, platformUsername)
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
                      <span className="text-xs">⚡</span>
                      <span className="text-xs sm:text-sm font-semibold">{profile.bullet}</span>
                    </div>
                  )}
                  {profile.blitz != null && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 border border-border/30 opacity-0">
                      <span className="text-xs">🔥</span>
                      <span className="text-xs sm:text-sm font-semibold">{profile.blitz}</span>
                    </div>
                  )}
                  {profile.rapid != null && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 border border-border/30 opacity-0">
                      <span className="text-xs">⏱️</span>
                      <span className="text-xs sm:text-sm font-semibold">{profile.rapid}</span>
                    </div>
                  )}
                  {profile.peak && (
                    <div className="rating-badge flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 opacity-0">
                      <span className="text-xs">🏆</span>
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
          <AnalysisReport result={result} />
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

const TC_ICONS: Record<string, string> = { bullet: '⚡', blitz: '🔥', rapid: '⏱️' }

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
              <span className="text-base">{TC_ICONS[step.timeClass] || ''}</span>
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

// ─── Report Display ───

function AnalysisReport({ result }: { result: ProfileAnalysisResult }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="report-section rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6">
        <h1 className="text-2xl font-bold mb-2">Play DNA — {result.username}</h1>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{result.gamesCount} games analyzed</span>
          <span>Avg rating: {result.avgRating}</span>
          <span>W: {result.wins} / L: {result.losses} / D: {result.draws}</span>
        </div>
      </div>

      {/* Per cadence */}
      {result.cadences.map((cadence) => (
        <CadenceSection key={cadence.tcType} cadence={cadence} />
      ))}
    </div>
  )
}

function CadenceSection({ cadence }: { cadence: ReturnType<typeof computePlayDNA>['cadences'][number] }) {
  const c = cadence

  return (
    <>
      {/* DNA Profile */}
      <div className="report-section rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6">
        <h2 className="text-lg font-semibold mb-4">{c.tcLabel} Profile — {c.style}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
          <Stat label="Accuracy" value={`${c.avgAccuracy?.toFixed(1) ?? '-'}%`} sub={`expected ${c.expected.toFixed(0)}%`} />
          <Stat label="Delta" value={`${c.delta != null && c.delta >= 0 ? '+' : ''}${c.delta?.toFixed(1) ?? '-'}%`} sub="vs expected" />
          <Stat label="Consistency" value={`${c.accStdDev?.toFixed(1) ?? '-'}`} sub="stddev" />
          <Stat label="Best Move Rate" value={`${c.bestMoveRate.toFixed(1)}%`} sub="non-book" />
          <Stat label="Blunder Rate" value={`${c.blunderRate.toFixed(1)}%`} sub="blunders + misses" />
          <Stat label="Think/Reflex" value={c.tempo.thinkReflexRatio != null ? `${c.tempo.thinkReflexRatio.toFixed(2)}x` : '-'} sub="critical vs calm" />
        </div>
      </div>

      {/* Piece DNA */}
      <div className="report-section rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Piece DNA ({c.tcLabel})</h3>
        <div className="space-y-2">
          {c.pieces.map((p) => (
            <div key={p.piece} className="flex items-center gap-3">
              <span className="w-16 text-sm text-muted-foreground">{p.label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    p.piece === c.strongestPiece?.piece ? 'bg-emerald-400' :
                    p.piece === c.weakestPiece?.piece ? 'bg-rose-400' : 'bg-sky-400'
                  }`}
                  style={{ width: `${Math.min(100, p.mean)}%` }}
                />
              </div>
              <span className="w-14 text-sm text-right font-medium">{p.mean.toFixed(1)}%</span>
            </div>
          ))}
        </div>
        {c.strongestPiece && c.weakestPiece && (
          <p className="text-xs text-muted-foreground mt-3">
            Strength: {c.strongestPiece.label} ({c.strongestPiece.mean.toFixed(0)}%) — Weakness: {c.weakestPiece.label} ({c.weakestPiece.mean.toFixed(0)}%)
          </p>
        )}
      </div>

      {/* Phase Balance */}
      <div className="report-section rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Phase Balance ({c.tcLabel})</h3>
        <div className="space-y-2">
          {c.phases.map((p) => (
            <div key={p.phase} className="flex items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">{p.label}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-violet-400 transition-all duration-500" style={{ width: `${Math.min(100, p.mean)}%` }} />
              </div>
              <span className="w-14 text-sm text-right font-medium">{p.mean.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Anti-Cheat */}
      <div className="report-section rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Anti-Cheat Analysis ({c.tcLabel})</h3>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${
              c.antiCheat.riskLevel === 'LOW' ? 'text-emerald-400' :
              c.antiCheat.riskLevel === 'MEDIUM' ? 'text-amber-400' : 'text-rose-400'
            }`}>{c.antiCheat.humanScore}/10</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${
              c.antiCheat.riskLevel === 'LOW' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
              c.antiCheat.riskLevel === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>{c.antiCheat.riskLevel} RISK</span>
          </div>
        </div>
        <div className="space-y-1.5">
          {c.antiCheat.checks.map((check, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${
                check.status === 'PASS' ? 'bg-emerald-500/10 text-emerald-400' :
                check.status === 'WARN' ? 'bg-amber-500/10 text-amber-400' :
                'bg-rose-500/10 text-rose-400'
              }`}>{check.status}</span>
              <span className="text-muted-foreground">{check.label.replace(/_/g, ' ')}</span>
              <span className="text-foreground font-medium ml-auto">{check.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Game Log */}
      <div className="report-section rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Game Log ({c.tcLabel})</h3>
        <div className="space-y-1">
          {c.games.map((g, i) => (
            <div key={g.gameId} className="flex items-center gap-2 text-sm py-1">
              <span className="w-6 text-muted-foreground text-right">{i + 1}.</span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden w-20 max-w-20">
                <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, g.accuracy || 0)}%` }} />
              </div>
              <span className="w-14 font-medium">{g.accuracy?.toFixed(1) ?? '-'}%</span>
              <span className={`w-4 font-bold ${g.result === 'W' ? 'text-emerald-400' : g.result === 'L' ? 'text-rose-400' : 'text-muted-foreground'}`}>{g.result}</span>
              <span className="text-muted-foreground truncate">{g.opponentName} ({g.opponentRating})</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
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
