'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key } from 'chessground/types'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowLeft, Clock, Copy, Check, Sparkles, Loader2, Eye, ShieldCheck, Target, Flame, AlertTriangle, Dna, Timer, Crown, Swords } from 'lucide-react'
import { PlayerAvatar } from '@/components/player-avatar'
import { EvalGraph } from '@/components/eval-graph'
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'
import { UpgradeButton } from '@/components/upgrade-button'

// Chess.com sends "greatFind" but we normalize to "great"
function normCls(cls?: string): string {
  if (cls === 'greatFind') return 'great'
  return cls || ''
}

interface ParsedMove {
  san: string
  fen: string
  clock?: string
  color: 'w' | 'b'
}

interface GameHeaders {
  White: string
  Black: string
  WhiteElo: string
  BlackElo: string
  WhiteRatingDiff: string
  BlackRatingDiff: string
  Result: string
  TimeControl: string
  ECO: string
  Date: string
}

export default function ReviewPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const gameId = params.gameId as string
  const gameType = searchParams.get('gameType') || 'live'

  const [orientation, setOrientation] = useState<'white' | 'black'>('white')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [moves, setMoves] = useState<ParsedMove[]>([])
  const [headers, setHeaders] = useState<GameHeaders | null>(null)
  const [currentPly, setCurrentPly] = useState(0)
  const [startFen, setStartFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
  const [pgn, setPgn] = useState('')
  // Audio (disabled — Chess.com audio URL pattern not found yet)
  // const [muted, setMuted] = useState(true)
  // const audioRef = useRef<HTMLAudioElement | null>(null)
  const [copied, setCopied] = useState(false)

  // Coach
  const [coachId, setCoachId] = useState('David_coach')
  const [showCoachModal, setShowCoachModal] = useState(false)

  // Review limit
  const [reviewLimit, setReviewLimit] = useState<{ isLimited: boolean; dailyUsage: number; dailyLimit: number | null }>({ isLimited: false, dailyUsage: 0, dailyLimit: null })
  const [showReviewConfirm, setShowReviewConfirm] = useState(false)
  const [limitReady, setLimitReady] = useState(false)
  const [cacheReady, setCacheReady] = useState(false)
  const reviewReady = limitReady && cacheReady
  useEffect(() => {
    async function fetchLimit() {
      try {
        const { supabase } = await import('@/lib/supabase')
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/review-limit', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        setReviewLimit(data)
      } catch { /* ignore */ } finally {
        setLimitReady(true)
      }
    }
    fetchLimit()
  }, [])

  // Load coach preference
  useEffect(() => {
    async function loadCoachPref() {
      try {
        const { supabase } = await import('@/lib/supabase')
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/coach-preference', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        if (data.coach) {
          // Migrate old coach IDs
          const migrated: Record<string, string> = { Generic_coach: 'David_coach', Vishy_coach: 'Anand_coach', BotezSisters_coach: 'Botez_coach' }
          setCoachId(migrated[data.coach] || data.coach)
        }
      } catch { /* use default */ }
    }
    loadCoachPref()
  }, [])

  // Coach change flow: select → confirm → re-analyze

  // Chess.com review
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewProgress, setReviewProgress] = useState(0)
  const [review, setReview] = useState<Record<string, unknown> | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [bestMoveHint, setBestMoveHint] = useState<{ ply: number; san: string } | null>(null)
  const [animatedPointCount, setAnimatedPointCount] = useState(0)
  const [isAnimating, setIsAnimating] = useState(false)
  const [isAutoPlaying, setIsAutoPlaying] = useState(false)
  const [autoPlayTarget, setAutoPlayTarget] = useState(0)

  // Analyze game function
  const analyzeGame = useCallback(async () => {
    setReviewLoading(true)
    setReviewError(null)
    setReviewProgress(0)
    setAnimatedPointCount(0)
    setIsAnimating(false)

    try {
      const { supabase } = await import('@/lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const wsUrl = process.env.NEXT_PUBLIC_CHESSR_WS_URL || 'ws://localhost:8080'
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        if (token) ws.send(JSON.stringify({ type: 'auth', token, source: 'app' }))
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'auth_success') {
            ws.send(JSON.stringify({
              type: 'chesscom_review',
              requestId: `review-${gameId}`,
              gameId,
              gameType,
              coachId,
              userColor: orientation === 'black' ? 'black' : 'white',
            }))
          }
          if (msg.type === 'chesscom_review_progress') {
            setReviewProgress(msg.progress)
          }
          if (msg.type === 'chesscom_review_result') {
            setReview(msg.analysis)
            setReviewLoading(false)
            setIsAnimating(true)
            setAnimatedPointCount(0)
            // Increment local usage count
            setReviewLimit(prev => prev.isLimited ? { ...prev, dailyUsage: prev.dailyUsage + 1 } : prev)
            ws.close()
          }
          if (msg.type === 'chesscom_review_error') {
            if (msg.error === 'daily_limit') {
              setReviewError(`Daily limit reached (${msg.dailyUsage}/${msg.dailyLimit}). Upgrade to Premium for unlimited reviews.`)
              setReviewLimit(prev => ({ ...prev, dailyUsage: msg.dailyUsage, dailyLimit: msg.dailyLimit }))
            } else {
              setReviewError(msg.error)
            }
            setReviewLoading(false)
            ws.close()
          }
        } catch { /* ignore */ }
      }

      ws.onerror = () => { setReviewError('Connection failed'); setReviewLoading(false) }
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Failed')
      setReviewLoading(false)
    }
  }, [gameId, coachId])

  // Coach change with confirmation
  const [pendingCoach, setPendingCoach] = useState<string | null>(null)

  const confirmCoachChange = useCallback(async () => {
    if (!pendingCoach) return
    // Save preference
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        fetch('/api/coach-preference', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ coach: pendingCoach }),
        })
      }
    } catch { /* ignore */ }

    userChangedCoachRef.current = true
    setReview(null)
    setAnimatedPointCount(0)
    setIsAnimating(false)
    setCoachId(pendingCoach)
    setPendingCoach(null)
    setShowCoachModal(false)
  }, [pendingCoach])

  const allEvalPoints = review ? buildEvalPoints(review, moves) : []

  useEffect(() => {
    if (!isAnimating || allEvalPoints.length === 0) return
    const total = allEvalPoints.length
    let frame = 0
    const interval = setInterval(() => {
      frame += 2 // 2 points per frame
      if (frame >= total) {
        setAnimatedPointCount(total)
        setIsAnimating(false)
        clearInterval(interval)
      } else {
        setAnimatedPointCount(frame)
      }
    }, 30) // 30ms per frame = ~1.5s for 100 moves
    return () => clearInterval(interval)
  }, [isAnimating, allEvalPoints.length])

  // Show animated subset during animation, full after
  const evalPoints = isAnimating ? allEvalPoints.slice(0, animatedPointCount) : allEvalPoints

  // Auto-play moves one by one until target
  useEffect(() => {
    if (!isAutoPlaying || autoPlayTarget <= currentPly) {
      if (isAutoPlaying) setIsAutoPlaying(false)
      return
    }
    const timer = setTimeout(() => {
      setCurrentPly(p => p + 1)
    }, 200)
    return () => clearTimeout(timer)
  }, [isAutoPlaying, autoPlayTarget, currentPly])

  // Board
  const boardRef = useRef<HTMLDivElement>(null)
  const cgRef = useRef<Api | null>(null)
  const moveListRef = useRef<HTMLDivElement>(null)

  // Fetch game data
  useEffect(() => {
    async function fetchGame() {
      try {
        // Check sessionStorage first (has PGN with clocks from games list)
        const storedPgn = sessionStorage.getItem(`pgn-${gameId}`)
        if (storedPgn) {
          parsePGN(storedPgn)
          return
        }

        // Fallback: Use our proxy API (avoids CORS)
        const apiRes = await fetch(`/api/game?id=${gameId}&gameType=${gameType}`)
        if (!apiRes.ok) throw new Error('Game not found')
        const apiData = await apiRes.json()

        if (apiData.headers) {
          const h = apiData.headers
          setHeaders({
            White: h.White || '', Black: h.Black || '',
            WhiteElo: h.WhiteElo || '', BlackElo: h.BlackElo || '',
            WhiteRatingDiff: h.WhiteRatingDiff || '', BlackRatingDiff: h.BlackRatingDiff || '',
            Result: h.Result || '', TimeControl: h.TimeControl || '',
            ECO: h.ECO || '', Date: h.Date || '',
          })
        }

        if (apiData.moves?.length) {
          setMoves(apiData.moves)
        } else {
          throw new Error('No move data found')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load game')
      } finally {
        setLoading(false)
      }
    }
    fetchGame()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // Check for cached review on mount and when coach changes
  const userChangedCoachRef = useRef(false)
  useEffect(() => {
    if (review || reviewLoading) return

    async function checkCacheAndAnalyze() {
      try {
        const res = await fetch(`/api/review-cache?id=${gameId}&coach=${coachId}`)
        const data = await res.json()
        if (data.cached && data.analysis) {
          setReview(data.analysis)
          setIsAnimating(true)
          setAnimatedPointCount(0)
          return
        }
      } catch { /* ignore */ }

      // No cache — auto-analyze only if user explicitly changed coach
      if (userChangedCoachRef.current) {
        analyzeGame()
      }
      userChangedCoachRef.current = false
    }
    checkCacheAndAnalyze().finally(() => setCacheReady(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, coachId])

  // Auto-detect orientation: fetch linked accounts and check which player is the user
  useEffect(() => {
    if (!headers) return
    async function detectOrientation() {
      try {
        const { supabase } = await import('@/lib/supabase')
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch('/api/linked-accounts', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const data = await res.json()
        const usernames = (data.accounts || []).map((a: { platform_username: string }) => a.platform_username.toLowerCase())
        if (headers?.Black && usernames.includes(headers.Black.toLowerCase())) {
          setOrientation('black')
        }
      } catch {
        // ignore — default to white
      }
    }
    detectOrientation()
  }, [headers])

  function parsePGN(pgnStr: string) {
    setPgn(pgnStr)
    // Extract headers
    const h: Record<string, string> = {}
    const headerRegex = /\[(\w+)\s+"([^"]+)"\]/g
    let match
    while ((match = headerRegex.exec(pgnStr)) !== null) {
      h[match[1]] = match[2]
    }
    setHeaders({
      White: h.White || '', Black: h.Black || '',
      WhiteElo: h.WhiteElo || '', BlackElo: h.BlackElo || '',
      Result: h.Result || '', TimeControl: h.TimeControl || '',
      ECO: h.ECO || '', Date: h.Date || '',
    })

    // Parse moves with chess.js
    const chess = new Chess()
    const moveText = pgnStr.replace(/^\[.*?\]\s*$/gm, '').trim()

    // Extract moves and clocks
    const parsed: ParsedMove[] = []
    const tokens = moveText.split(/(\{[^}]*\}|\d+\.+\s*)/).filter(t => t.trim())

    let lastClock: string | undefined
    for (const token of tokens) {
      const t = token.trim()
      if (!t || /^\d+\.+$/.test(t)) continue

      // Clock annotation
      const clockMatch = t.match(/\[%clk\s+([^\]]+)\]/)
      if (clockMatch) {
        lastClock = clockMatch[1]
        if (parsed.length > 0 && !parsed[parsed.length - 1].clock) {
          parsed[parsed.length - 1].clock = lastClock
        }
        continue
      }

      // Skip annotations
      if (t.startsWith('{') || t.startsWith('[')) continue

      // Result
      if (['1-0', '0-1', '1/2-1/2', '*'].includes(t)) continue

      // Move number prefix removal
      const san = t.replace(/^\d+\.\.\.\s*/, '').replace(/^\d+\.\s*/, '').trim()
      if (!san) continue

      try {
        const move = chess.move(san)
        if (move) {
          parsed.push({
            san: move.san,
            fen: chess.fen(),
            color: move.color,
            clock: undefined,
          })
        }
      } catch {
        // skip invalid
      }
    }

    setMoves(parsed)
    if (h.FEN) setStartFen(h.FEN)
  }

  function decodeMoveList(moveList: string) {
    function charToIdx(ch: string): number {
      const cc = ch.charCodeAt(0)
      if (cc >= 97 && cc <= 122) return cc - 97
      if (cc >= 65 && cc <= 90) return cc - 65 + 26
      if (cc >= 48 && cc <= 57) return cc - 48 + 52
      if (cc === 33) return 62
      if (cc === 63) return 63
      return -1
    }
    function idxToSq(idx: number): string {
      return String.fromCharCode(97 + (idx % 8)) + (Math.floor(idx / 8) + 1)
    }

    const chess = new Chess()
    const parsed: ParsedMove[] = []

    for (let i = 0; i + 1 < moveList.length; i += 2) {
      const fi = charToIdx(moveList[i]), ti = charToIdx(moveList[i + 1])
      if (fi < 0 || ti < 0) continue
      const from = idxToSq(fi), to = idxToSq(ti)

      let move = chess.move({ from, to })
      if (!move) {
        for (const p of ['q', 'r', 'b', 'n'] as const) {
          move = chess.move({ from, to, promotion: p })
          if (move) break
        }
      }
      if (move) {
        parsed.push({ san: move.san, fen: chess.fen(), color: move.color })
      }
    }
    setMoves(parsed)
  }

  // Init chessground
  useEffect(() => {
    if (!boardRef.current) return
    const cg = Chessground(boardRef.current, {
      viewOnly: true,
      coordinates: true,
      animation: { enabled: true, duration: 150 },
      fen: startFen,
      orientation,
      drawable: {
        enabled: false,
        brushes: {
          green:      { key: 'green',      color: '#15781B', opacity: 1, lineWidth: 10 },
          red:        { key: 'red',        color: '#882020', opacity: 1, lineWidth: 10 },
          blue:       { key: 'blue',       color: '#003088', opacity: 1, lineWidth: 10 },
          yellow:     { key: 'yellow',     color: '#e68f00', opacity: 1, lineWidth: 10 },
          paleBlue:   { key: 'paleBlue',   color: '#003088', opacity: 1, lineWidth: 15 },
          paleGreen:  { key: 'paleGreen',  color: '#15781B', opacity: 1, lineWidth: 15 },
          paleRed:    { key: 'paleRed',    color: '#882020', opacity: 1, lineWidth: 15 },
          paleGrey:   { key: 'paleGrey',   color: '#4a4a4a', opacity: 1, lineWidth: 15 },
          brilliant:  { key: 'brilliant',  color: '#22d3ee', opacity: 1, lineWidth: 10 },
          great:      { key: 'great',      color: '#749BBF', opacity: 1, lineWidth: 10 },
          best:       { key: 'best',       color: '#81B64C', opacity: 1, lineWidth: 10 },
          excellent:  { key: 'excellent',  color: '#81B64C', opacity: 1, lineWidth: 10 },
          good:       { key: 'good',       color: '#95b776', opacity: 1, lineWidth: 10 },
          book:       { key: 'book',       color: '#D5A47D', opacity: 1, lineWidth: 10 },
          forced:     { key: 'forced',     color: '#96af8b', opacity: 1, lineWidth: 10 },
          inaccuracy: { key: 'inaccuracy', color: '#F7C631', opacity: 1, lineWidth: 10 },
          mistake:    { key: 'mistake',    color: '#FFA459', opacity: 1, lineWidth: 10 },
          miss:       { key: 'miss',       color: '#FF7769', opacity: 1, lineWidth: 10 },
          blunder:    { key: 'blunder',    color: '#FA412D', opacity: 1, lineWidth: 10 },
        } as never,
      },
    })
    cgRef.current = cg
    return () => { cg.destroy(); cgRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orientation])

  // Update board on ply change
  useEffect(() => {
    if (!cgRef.current) return
    const fen = currentPly === 0 ? startFen : moves[currentPly - 1]?.fen
    if (!fen) return
    cgRef.current.set({ fen })

    // Highlight last move + check/mate + arrow
    if (currentPly > 0) {
      const prevFen = currentPly >= 2 ? moves[currentPly - 2]?.fen : startFen
      const chess = new Chess(prevFen)
      const move = chess.move(moves[currentPly - 1]?.san)
      if (move) {
        cgRef.current.set({
          lastMove: [move.from as Key, move.to as Key],
          check: chess.isCheck() ? (chess.turn() === 'w' ? 'white' : 'black') : undefined,
        })

        // Get classification for arrow + highlight color
        const reviewPositions = review ? (review.positions as Array<{ classificationName?: string }>) : null
        const cls = normCls(reviewPositions?.[currentPly]?.classificationName)

        // Custom colors matching classification badges
        const CLS_ARROW_COLOR: Record<string, string> = {
          brilliant: '#22d3ee', great: '#749BBF', best: '#81B64C', excellent: '#81B64C',
          good: '#95b776', book: '#D5A47D', forced: '#96af8b',
          inaccuracy: '#F7C631', mistake: '#FFA459', miss: '#FF7769', blunder: '#FA412D',
        }
        const arrowColor = CLS_ARROW_COLOR[cls] || '#888'

        // Show best move arrow (green) if move isn't best/book, otherwise show played move arrow
        const shapes: Array<{ orig: Key; dest: Key; brush: string }> = []
        let showedBest = false

        if (review && cls && !['best', 'book'].includes(cls)) {
          const reviewPos = (review.positions as Array<{ suggestedMove?: { moveLan?: string } }>)?.[currentPly]
          const sugLan = reviewPos?.suggestedMove?.moveLan
          if (sugLan && sugLan.length >= 4) {
            shapes.push({
              orig: sugLan.slice(0, 2) as Key,
              dest: sugLan.slice(2, 4) as Key,
              brush: 'best',
            })
            showedBest = true
          }
        }

        if (!showedBest) {
          shapes.push({
            orig: move.from as Key,
            dest: move.to as Key,
            brush: cls && CLS_ARROW_COLOR[cls] ? cls : 'paleBlue',
          })
        }

        cgRef.current.setAutoShapes(shapes)

        // Color the lastMove highlight via CSS variable
        const boardEl = boardRef.current
        if (boardEl) {
          boardEl.style.setProperty('--lm-color', `${arrowColor}50`)
        }
      }
    } else {
      cgRef.current.set({ lastMove: undefined, check: undefined })
      cgRef.current.setAutoShapes([])
    }
  }, [currentPly, moves, startFen])

  // Auto-scroll move list + clear best move hint on ply change
  useEffect(() => {
    setBestMoveHint(null)
    const el = moveListRef.current?.querySelector(`[data-ply="${currentPly}"]`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPly])

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setCurrentPly(p => Math.min(p + 1, moves.length))
      else if (e.key === 'ArrowLeft') setCurrentPly(p => Math.max(p - 1, 0))
      else if (e.key === 'Home') setCurrentPly(0)
      else if (e.key === 'End') setCurrentPly(moves.length)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [moves.length])

  const goFirst = useCallback(() => setCurrentPly(0), [])
  const goPrev = useCallback(() => setCurrentPly(p => Math.max(p - 1, 0)), [])
  const goNext = useCallback(() => setCurrentPly(p => Math.min(p + 1, moves.length)), [moves.length])
  const goLast = useCallback(() => setCurrentPly(moves.length), [moves.length])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-3">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
        <div className="text-sm text-muted-foreground">Loading game info...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-4">
        <div className="text-rose-400">{error}</div>
        <a href="/" className="text-sm text-primary hover:underline flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to games
        </a>
      </div>
    )
  }

  // Current move clocks
  const currentMove = currentPly > 0 ? moves[currentPly - 1] : null
  const whiteClock = currentMove?.color === 'w' ? currentMove.clock : (currentPly >= 2 ? moves.slice(0, currentPly).filter(m => m.color === 'w').pop()?.clock : undefined)
  const blackClock = currentMove?.color === 'b' ? currentMove.clock : (currentPly >= 2 ? moves.slice(0, currentPly).filter(m => m.color === 'b').pop()?.clock : undefined)

  return (
    <div className="min-h-screen bg-background">
      {/* Background */}
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

      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/60 backdrop-blur-xl">
        <div className="w-full px-4 sm:px-6 h-12 sm:h-14 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-6">
            <a href="/" className="flex items-center gap-2 shrink-0">
              <img src="/icon.png" alt="Chessr" className="w-6 h-6 sm:w-8 sm:h-8" />
              <span className="text-lg sm:text-xl font-bold hidden sm:inline">
                <span className="text-white">chessr</span><span className="gradient-text">.io</span>
              </span>
            </a>
            <nav className="flex items-center gap-1">
              <a href="/" className="px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium text-foreground bg-muted whitespace-nowrap">Games</a>
              <a href="/profile-analysis" className="px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 whitespace-nowrap">Analysis</a>
            </nav>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {pgn && (
              <button
                onClick={() => { navigator.clipboard.writeText(pgn); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                PGN
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Players bar */}
      {headers && (() => {
        const result = headers.Result
        const whiteWon = result === '1-0'
        const blackWon = result === '0-1'
        const isDraw = result === '1/2-1/2'
        const wResult = whiteWon ? 'Win' : blackWon ? 'Loss' : 'Draw'
        const bResult = blackWon ? 'Win' : whiteWon ? 'Loss' : 'Draw'
        const resultColor = (r: string) => r === 'Win' ? 'text-emerald-400 bg-emerald-500/15' : r === 'Loss' ? 'text-rose-400 bg-rose-500/15' : 'text-muted-foreground bg-muted/50'

        return (
          <div className="relative z-10">
            <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PlayerInfo name={headers.White} elo={headers.WhiteElo} eloDiff={headers.WhiteRatingDiff} color="white" />
                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${resultColor(wResult)}`}>{wResult}</span>
              </div>
              <div className="text-xs text-muted-foreground">vs</div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${resultColor(bResult)}`}>{bResult}</span>
                <PlayerInfo name={headers.Black} elo={headers.BlackElo} eloDiff={headers.BlackRatingDiff} color="black" />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Main content */}
      <main className="relative z-10 max-w-6xl mx-auto p-4">
        {/* Analyze button + loading (no card wrapper) */}
        {!review && !reviewLoading && !reviewReady && (
          <div className="mb-4 flex justify-center">
            <div className="h-10 w-44 bg-muted/50 rounded-xl animate-pulse" />
          </div>
        )}
        {!review && !reviewLoading && reviewReady && (
          <div className="mb-4 flex flex-col items-center gap-2">
            {reviewLimit.isLimited && reviewLimit.dailyLimit != null && reviewLimit.dailyUsage >= reviewLimit.dailyLimit ? (
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="text-rose-400 font-medium text-sm">Daily limit reached ({reviewLimit.dailyLimit}/{reviewLimit.dailyLimit})</div>
                <UpgradeButton>Upgrade for unlimited reviews</UpgradeButton>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (reviewLimit.isLimited) {
                    setShowReviewConfirm(true)
                  } else {
                    analyzeGame()
                  }
                }}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <Sparkles className="w-4 h-4" /> Analyze Game
                {reviewLimit.isLimited && reviewLimit.dailyLimit != null && (
                  <span className="text-xs opacity-75 ml-1">({reviewLimit.dailyUsage}/{reviewLimit.dailyLimit})</span>
                )}
              </button>
            )}
          </div>
        )}
        {reviewLoading && (
          <div className="mb-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Reviewing game... {reviewProgress}%
          </div>
        )}
        {reviewError && (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {reviewError}
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-4">
          {/* Board + eval bar */}
          <div className="flex flex-col items-center gap-3">
            <div>
              {/* Top player bar (opponent from board perspective) */}
              {headers && (
                <BoardPlayerBar
                  name={orientation === 'white' ? headers.Black : headers.White}
                  elo={orientation === 'white' ? headers.BlackElo : headers.WhiteElo}
                  clock={orientation === 'white' ? blackClock : whiteClock}
                  isActive={orientation === 'white' ? currentMove?.color === 'b' : currentMove?.color === 'w'}
                  color={orientation === 'white' ? 'black' : 'white'}
                />
              )}
              <div className="flex gap-1">
                {/* Eval bar */}
                {review && (
                  <EvalBar
                    review={review}
                    currentPly={currentPly}
                    orientation={orientation}
                  />
                )}
                <div className="relative">
                <div
                  ref={boardRef}
                  className="rounded-lg overflow-hidden"
                  style={{ width: 'min(calc(100vw - 56px), 480px)', height: 'min(calc(100vw - 56px), 480px)' }}
                />
                {review && currentPly > 0 && !bestMoveHint && (() => {
                  const reviewPositions = review.positions as Array<{ classificationName?: string; playedMove?: { moveLan?: string } }> | undefined
                  const pos = reviewPositions?.[currentPly]
                  const cls = normCls(pos?.classificationName)
                  const lan = pos?.playedMove?.moveLan
                  if (!cls || !lan || lan.length < 4) return null
                  const destFile = lan.charCodeAt(2) - 97 // 0-7
                  const destRank = parseInt(lan[3]) - 1   // 0-7
                  const col = orientation === 'white' ? destFile : 7 - destFile
                  const row = orientation === 'white' ? 7 - destRank : destRank
                  return (
                    <div
                      className="absolute pointer-events-none z-10"
                      style={{
                        left: `${(col / 8) * 100}%`,
                        top: `${(row / 8) * 100}%`,
                        width: '12.5%',
                        height: '12.5%',
                      }}
                    >
                      <img
                        src={`/icons/cls-${cls}.svg`}
                        alt={cls}
                        className="absolute -top-1 -right-1 w-5 h-5 drop-shadow-md"
                      />
                    </div>
                  )
                })()}
              </div>
              </div>
              {/* Bottom player bar (you from board perspective) */}
              {headers && (
                <BoardPlayerBar
                  name={orientation === 'white' ? headers.White : headers.Black}
                  elo={orientation === 'white' ? headers.WhiteElo : headers.BlackElo}
                  clock={orientation === 'white' ? whiteClock : blackClock}
                  isActive={orientation === 'white' ? currentMove?.color === 'w' : currentMove?.color === 'b'}
                  color={orientation === 'white' ? 'white' : 'black'}
                />
              )}
            </div>

            {/* Nav controls */}
            <div className="flex items-center gap-1">
              <NavBtn onClick={goFirst}><ChevronsLeft className="w-5 h-5" /></NavBtn>
              <NavBtn onClick={goPrev}><ChevronLeft className="w-5 h-5" /></NavBtn>
              <div className="px-3 text-xs text-muted-foreground font-mono min-w-[60px] text-center">
                {currentPly} / {moves.length}
              </div>
              <NavBtn onClick={goNext}><ChevronRight className="w-5 h-5" /></NavBtn>
              <NavBtn onClick={goLast}><ChevronsRight className="w-5 h-5" /></NavBtn>
            </div>
          </div>

          {/* Move list with coach banner on top */}
          <div className="flex-1 min-w-0 lg:max-h-[540px] max-h-[400px] flex flex-col rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
            {/* Coach banner / Game summary */}
            {review && currentPly === 0 && typeof review.gameSummary === 'string' && (
              <GameSummaryBanner
                review={review}
                coachId={coachId}
                onChangeCoach={() => setShowCoachModal(true)}
                onStartReview={() => setCurrentPly(1)}
              />
            )}
            {review && currentPly > 0 && (
              <CoachBanner review={review} currentPly={currentPly} coachId={coachId} isAutoPlaying={isAutoPlaying} autoPlayTarget={autoPlayTarget} onChangeCoach={() => setShowCoachModal(true)} onNext={() => {
                if (isAutoPlaying) return
                const positions = review.positions as Array<{ classificationName?: string }> | undefined
                if (!positions) return
                const dominated = new Set(['best', 'good', 'excellent', 'forced', 'book'])
                // Find target ply
                let target = moves.length
                for (let i = currentPly + 1; i < positions.length && i <= moves.length; i++) {
                  const cls = normCls(positions[i]?.classificationName)
                  if (cls && !dominated.has(cls)) { target = i; break }
                }
                if (target <= currentPly) return
                // Auto-play to target
                setAutoPlayTarget(target)
                setIsAutoPlaying(true)
              }} onShowBestMove={(bestMoveLan) => {
                if (!cgRef.current) return
                const prevFen = currentPly >= 2 ? moves[currentPly - 2]?.fen : startFen
                if (!prevFen) return
                const chess = new Chess(prevFen)
                const bestFrom = bestMoveLan.slice(0, 2)
                const bestTo = bestMoveLan.slice(2, 4)
                const promo = bestMoveLan.length > 4 ? bestMoveLan[4] : undefined
                let bestMove: ReturnType<typeof chess.move> | null = null
                try {
                  bestMove = chess.move({ from: bestFrom, to: bestTo, promotion: promo as 'q' | 'r' | 'b' | 'n' | undefined })
                  if (!bestMove) bestMove = chess.move({ from: bestFrom, to: bestTo, promotion: 'q' })
                } catch { /* invalid move */ }
                if (!bestMove) {
                  // Fallback: just show the arrow without moving
                  cgRef.current.setAutoShapes([{ orig: bestFrom as Key, dest: bestTo as Key, brush: 'best' }])
                  return
                }
                // Show the position after best move on the board
                cgRef.current.set({
                  fen: chess.fen(),
                  lastMove: [bestFrom as Key, bestTo as Key],
                  check: chess.isCheck() ? (chess.turn() === 'w' ? 'white' : 'black') : undefined,
                })
                // Show hint row in move list
                setBestMoveHint({ ply: currentPly, san: bestMove.san })
                // Show follow-up arrow from PV (principal variation)
                const reviewPositions = review.positions as Array<{ suggestedMove?: { eval?: { pv?: string[] } }; bestMove?: { eval?: { pv?: string[] } } }> | undefined
                const pos = reviewPositions?.[currentPly]
                const pv = pos?.suggestedMove?.eval?.pv || pos?.bestMove?.eval?.pv || []
                // pv[0] is the best move itself, pv[1] is the opponent's response
                if (pv.length >= 2) {
                  const fuLan = pv[1]
                  if (fuLan && fuLan.length >= 4) {
                    cgRef.current.setAutoShapes([{
                      orig: fuLan.slice(0, 2) as Key,
                      dest: fuLan.slice(2, 4) as Key,
                      brush: 'brilliant',
                    }])
                  }
                } else {
                  cgRef.current.setAutoShapes([])
                }
              }} />
            )}

            {/* Scrollable moves */}
            <div className="flex-1 overflow-y-auto" ref={moveListRef}>
            <div className="p-1.5 sm:p-2">
              {(() => {
                const reviewPositions = review ? (review.positions as Array<{ classificationName?: string }>) : null
                return Array.from({ length: Math.ceil(moves.length / 2) }).map((_, i) => {
                  const wPly = i * 2 + 1
                  const bPly = i * 2 + 2
                  const wMove = moves[wPly - 1]
                  const bMove = moves[bPly - 1]
                  const wClsRaw = normCls(reviewPositions?.[wPly]?.classificationName)
                  const bClsRaw = normCls(reviewPositions?.[bPly]?.classificationName)
                  // Don't flag opponent's book moves
                  const wCls = (wClsRaw === 'book' && orientation === 'black') ? '' : wClsRaw
                  const bCls = (bClsRaw === 'book' && orientation === 'white') ? '' : bClsRaw
                  const hintOnWhite = bestMoveHint?.ply === wPly
                  const hintOnBlack = bestMoveHint?.ply === bPly
                  return (
                    <div key={i}>
                      <div className={`flex items-stretch text-sm ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                        <div className="w-8 sm:w-10 text-right pr-1.5 py-1 text-xs text-muted-foreground/60 font-mono shrink-0">{i + 1}.</div>
                        <MoveCell
                          san={wMove?.san}
                          isActive={currentPly === wPly}
                          onClick={() => setCurrentPly(wPly)}
                          ply={wPly}
                          classification={wCls}
                          isWhite={true}
                          isPlayer={orientation === 'white'}
                        />
                        {bMove ? (
                          <MoveCell
                            san={bMove.san}
                            isActive={currentPly === bPly}
                            onClick={() => setCurrentPly(bPly)}
                            ply={bPly}
                            classification={bCls}
                            isWhite={false}
                            isPlayer={orientation === 'black'}
                          />
                        ) : <div className="flex-1" />}
                      </div>
                      {(hintOnWhite || hintOnBlack) && bestMoveHint && (
                        <div className="flex items-stretch text-sm bg-emerald-500/10 border-l-2 border-emerald-500">
                          <div className="w-8 sm:w-10 shrink-0" />
                          {hintOnWhite ? (
                            <>
                              <div className="flex-1 flex items-center px-2 py-1">
                                <span className="font-mono text-sm text-emerald-400">{formatSan(bestMoveHint.san, true)}</span>
                              </div>
                              <div className="flex-1" />
                            </>
                          ) : (
                            <>
                              <div className="flex-1" />
                              <div className="flex-1 flex items-center px-2 py-1">
                                <span className="font-mono text-sm text-emerald-400">{formatSan(bestMoveHint.san, false)}</span>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
          </div>
        </div>

        {/* Eval Graph (between moves and review panel) */}
        {evalPoints.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm mt-4 overflow-hidden">
            <EvalGraph
              points={evalPoints}
              currentPly={currentPly}
              onSelectPly={setCurrentPly}
              totalPlies={moves.length}
              orientation={orientation}
            />
          </div>
        )}

        {/* Review error */}
        {reviewError && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
            {reviewError}
          </div>
        )}

        {/* Review results */}
        {review && <ReviewPanel review={review} headers={headers} />}
        {review && <GameAnalysisSections review={review} headers={headers} orientation={orientation} />}
      </main>

      {/* Coach selection modal */}
      {showCoachModal && !pendingCoach && (
        <CoachModal
          currentCoach={coachId}
          onSelect={(id) => { if (id === coachId) { setShowCoachModal(false); return } setPendingCoach(id) }}
          onClose={() => setShowCoachModal(false)}
        />
      )}

      {/* Review confirmation dialog for free users */}
      {showReviewConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReviewConfirm(false)}>
          <div className="bg-card border border-border/60 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Start a game review?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              You have <span className="font-medium text-foreground">{Math.max(0, (reviewLimit.dailyLimit ?? 0) - reviewLimit.dailyUsage)}</span> of{' '}
              <span className="font-medium text-foreground">{reviewLimit.dailyLimit}</span> reviews remaining today.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowReviewConfirm(false)}
                className="px-4 py-2 text-sm rounded-lg border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowReviewConfirm(false); analyzeGame() }}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
              >
                Start Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Coach change confirmation */}
      {pendingCoach && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingCoach(null)}>
          <div className="bg-card/80 backdrop-blur-xl border border-border/60 rounded-xl p-5 w-full max-w-xs mx-4 text-center" onClick={e => e.stopPropagation()}>
            <img src={COACHES[pendingCoach]?.img || COACHES.David_coach.img} alt="" className="w-16 h-16 rounded-xl mx-auto mb-3" />
            <p className="text-sm mb-2">Do you want to review again with <span className="font-bold">{COACHES[pendingCoach]?.name || pendingCoach}</span>?</p>
            {reviewLimit.isLimited && reviewLimit.dailyLimit != null && (
              <p className="text-xs text-muted-foreground mb-3">{reviewLimit.dailyUsage}/{reviewLimit.dailyLimit} daily reviews used</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setPendingCoach(null)}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmCoachChange}
                className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Review
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Eval Bar ───

function EvalBar({ review, currentPly, orientation }: {
  review: Record<string, unknown>; currentPly: number; orientation: 'white' | 'black'
}) {
  const positions = review.positions as Array<Record<string, unknown>> | undefined
  let evalScore = 0
  if (positions && currentPly > 0 && positions[currentPly]) {
    evalScore = extractEval(positions[currentPly]) ?? 0
  }

  // Clamp eval to [-10, 10] and convert to percentage (white portion)
  const clamped = Math.max(-10, Math.min(10, evalScore))
  // 0 = 50%, +10 = 100% white, -10 = 0% white
  let whitePct = 50 + (clamped / 10) * 50
  // Flip if board is flipped
  if (orientation === 'black') whitePct = 100 - whitePct

  const displayEval = Math.abs(evalScore) >= 10
    ? (evalScore > 0 ? 'M' : '-M')
    : Math.abs(evalScore).toFixed(1)

  // When black is at bottom, bar background is white (top) and fill is black (bottom)
  const isFlipped = orientation === 'black'
  const bgColor = isFlipped ? 'bg-white' : 'bg-zinc-800'
  const fillColor = isFlipped ? 'bg-zinc-800' : 'bg-white'
  // Eval text: show on the smaller side
  const evalOnTop = isFlipped ? evalScore <= 0 : evalScore >= 0
  const evalTextColor = isFlipped
    ? (evalOnTop ? 'text-zinc-900' : 'text-white')
    : (evalOnTop ? 'text-white' : 'text-zinc-900')

  return (
    <div className={`relative w-5 rounded-lg overflow-hidden ${bgColor} shrink-0`} style={{ height: 'min(calc(100vw - 56px), 480px)' }}>
      <div
        className={`absolute bottom-0 left-0 right-0 ${fillColor} transition-all duration-300`}
        style={{ height: `${whitePct}%` }}
      />
      <div className={`absolute left-0 right-0 text-center text-[9px] font-bold font-mono ${
        evalOnTop ? 'top-1' : 'bottom-1'
      } ${evalTextColor}`}>
        {displayEval}
      </div>
    </div>
  )
}

// ─── Game Summary Banner (ply 0) ───

function GameSummaryBanner({ review, coachId, onChangeCoach, onStartReview }: {
  review: Record<string, unknown>; coachId: string; onChangeCoach: () => void; onStartReview: () => void
}) {
  const coach = COACHES[coachId] || COACHES.David_coach
  const summary = review.gameSummary as string

  return (
    <div className="p-3 border-b border-border/30">
      <div className="flex items-start gap-2.5">
        <button onClick={onChangeCoach} className="shrink-0 group relative" title="Change coach">
          <img src={coach.img} alt={coach.name} className="w-12 h-12 rounded-lg" />
          <div className="absolute inset-0 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M10.5 1.5l-9 9M1.5 1.5l9 9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
        </button>
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-lg rounded-tl-none px-3 py-2 text-zinc-900">
            <div className="text-sm leading-relaxed">{summary}</div>
          </div>
          <button
            onClick={onStartReview}
            className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Start Review
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Coach Banner with avatar + speech bubble ───

const COACHES: Record<string, { name: string; img: string }> = {
  David_coach: { name: 'David', img: 'https://assets-coaches.chess.com/image/coachdavid.png' },
  Mae_coach: { name: 'Mae', img: 'https://assets-coaches.chess.com/image/coachmae.png' },
  Dante_coach: { name: 'Dante', img: 'https://assets-coaches.chess.com/image/coachdante.png' },
  Nadia_coach: { name: 'Nadia', img: 'https://assets-coaches.chess.com/image/coachnadia.png' },
  Levy_coach: { name: 'Levy', img: 'https://assets-coaches.chess.com/image/coachlevy.png' },
  Hikaru_coach: { name: 'Hikaru', img: 'https://assets-coaches.chess.com/image/coachhikaru.png' },
  Anna_coach: { name: 'Anna', img: 'https://assets-coaches.chess.com/image/coachanna.png' },
  Magnus_coach: { name: 'Magnus', img: 'https://assets-coaches.chess.com/image/coachmagnus.png' },
  Canty_coach: { name: 'Canty', img: 'https://assets-coaches.chess.com/image/coachcanty.png' },
  Anand_coach: { name: 'Vishy', img: 'https://assets-coaches.chess.com/image/coachvishy.png' },
  Tania_coach: { name: 'Tania', img: 'https://assets-coaches.chess.com/image/coachtania.png' },
  Danny_coach: { name: 'Danny', img: 'https://assets-coaches.chess.com/image/coachdanny.png' },
  Botez_coach: { name: 'Botez', img: 'https://assets-coaches.chess.com/image/coachbotezsisters.png' },
  Ben_coach: { name: 'Ben', img: 'https://assets-coaches.chess.com/image/coachben.png' },
  Danya_coach: { name: 'Danya', img: 'https://assets-coaches.chess.com/image/coachdanya.png' },
  Drwolf_coach: { name: 'Dr. Wolf', img: 'https://assets-coaches.chess.com/image/coachdrwolf.png' },
  Calvin_coach: { name: 'Calvin', img: 'https://assets-coaches.chess.com/image/coachcalvin.png' },
  Sloane_coach: { name: 'Sloane', img: 'https://assets-coaches.chess.com/image/coachsloane.png' },
  Ruben_coach: { name: 'Ruben', img: 'https://assets-coaches.chess.com/image/coachruben.png' },
  Mittens_coach: { name: 'Mittens', img: 'https://assets-coaches.chess.com/image/coachmittens.png' },
}

function CoachBanner({ review, currentPly, coachId, isAutoPlaying, autoPlayTarget, onChangeCoach, onNext, onShowBestMove }: {
  review: Record<string, unknown>; currentPly: number; coachId: string; isAutoPlaying: boolean; autoPlayTarget: number; onChangeCoach: () => void; onNext: () => void; onShowBestMove: (bestMoveLan: string) => void
}) {
  const positions = (review.positions as Array<Record<string, unknown>>) || []
  const pos = positions[currentPly]

  const cls = pos ? normCls(pos.classificationName as string) : ''
  const played = pos ? pos.playedMove as Record<string, unknown> | null : null
  const best = pos ? pos.bestMove as Record<string, unknown> | null : null
  const suggested = pos ? pos.suggestedMove as Record<string, unknown> | null : null
  const moveLan = (played?.moveLan as string) || ''
  const suggestedLan = (suggested?.moveLan as string) || ''
  const hasBestMove = suggestedLan && suggestedLan !== moveLan && cls !== 'best' && cls !== 'book'
  const score = played?.score as number | undefined
  const evalStr = score != null ? (score >= 0 ? `+${score.toFixed(2)}` : score.toFixed(2)) : ''

  const speechArr = (played?.speech as Array<{ sentence: string[]; audioUrlHash?: string }>) ||
                    (best?.speech as Array<{ sentence: string[]; audioUrlHash?: string }>) || []
  const text = speechArr[0]?.sentence?.join('') || ''

  const coach = COACHES[coachId] || COACHES.David_coach
  const hideBubble = isAutoPlaying && (autoPlayTarget - currentPly) > 1

  // Animate bubble in
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const prevHideBubble = useRef(hideBubble)
  useEffect(() => {
    if (!hideBubble && prevHideBubble.current) {
      // Was hidden, now showing — trigger animation
      setBubbleVisible(false)
      requestAnimationFrame(() => setBubbleVisible(true))
    } else if (!hideBubble) {
      setBubbleVisible(true)
    }
    prevHideBubble.current = hideBubble
  }, [hideBubble, currentPly])

  // Reset animation on ply change (when not auto-playing)
  useEffect(() => {
    if (hideBubble) return
    setBubbleVisible(false)
    requestAnimationFrame(() => setBubbleVisible(true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPly])

  // Typewriter effect
  const [displayedText, setDisplayedText] = useState('')
  const textRef = useRef('')
  useEffect(() => {
    if (hideBubble || !text) { setDisplayedText(''); return }
    // New text — start typewriter
    textRef.current = text
    setDisplayedText('')
    let i = 0
    const interval = setInterval(() => {
      i += 2
      if (i >= textRef.current.length) {
        setDisplayedText(textRef.current)
        clearInterval(interval)
      } else {
        setDisplayedText(textRef.current.slice(0, i))
      }
    }, 15)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPly, hideBubble])

  if (!pos) return null

  return (
    <div className="p-2 border-b border-border/30">
      <div className="flex items-start gap-2">
        {/* Coach avatar */}
        <button
          onClick={onChangeCoach}
          className="shrink-0 group relative"
          title="Change coach"
        >
          <img src={coach.img} alt={coach.name} className="w-10 h-10 rounded-lg" />
          <div className="absolute inset-0 rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M10.5 1.5l-9 9M1.5 1.5l9 9" stroke="white" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </div>
        </button>

        {/* Speech bubble */}
        <div
          className={`flex-1 min-w-0 bg-white rounded-lg rounded-tl-none px-3 py-2 text-zinc-900 relative transition-all duration-200 ${
            hideBubble ? 'invisible' : bubbleVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
          }`}
        >
          {/* Header */}
          <div className="flex items-center gap-1.5 mb-0.5">
            <img src={`/icons/cls-${cls || 'good'}.svg`} alt={cls} className="w-4 h-4 shrink-0" />
            <span className="text-xs font-bold truncate capitalize">{cls}</span>
            {evalStr && (
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-zinc-200 text-zinc-700 ml-auto shrink-0">{evalStr}</span>
            )}
          </div>
          {/* Coach text — typewriter */}
          {text && <div className="text-[11px] text-zinc-600 leading-relaxed">{displayedText}<span className="inline-block w-[1px] h-3 bg-zinc-400 align-middle ml-[1px] animate-pulse" /></div>}
        </div>
      </div>
      <div className="flex justify-end mt-1.5 h-7 gap-2">
        {!isAutoPlaying && hasBestMove && (
          <button
            onClick={() => onShowBestMove(suggestedLan)}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:opacity-90 transition-opacity"
          >
            Show Best Move
          </button>
        )}
        {!isAutoPlaying && (
          <button
            onClick={onNext}
            className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Coach Selection Modal ───

function CoachModal({ currentCoach, onSelect, onClose }: {
  currentCoach: string; onSelect: (id: string) => void; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card/80 backdrop-blur-xl border border-border/60 rounded-xl p-4 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-3">Choose your coach</h3>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
          {Object.entries(COACHES).map(([id, coach]) => (
            <button
              key={id}
              onClick={() => { onSelect(id); onClose() }}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-lg transition-colors ${
                currentCoach === id ? 'bg-primary/20 ring-1 ring-primary' : 'hover:bg-muted'
              }`}
            >
              <img src={coach.img} alt={coach.name} className="w-14 h-14 rounded-lg object-cover object-top" />
              <span className="text-[10px] font-medium text-center">{coach.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function extractEval(pos: Record<string, unknown>): number | null {
  const played = pos.playedMove as Record<string, unknown> | null
  const best = pos.bestMove as Record<string, unknown> | null

  // Check for mate
  if (played?.mateIn != null) return (played.mateIn as number) > 0 ? 10 : -10
  if (best?.mateIn != null) return (best.mateIn as number) > 0 ? 10 : -10

  // Get eval from played move or best move
  const playedEval = played?.eval as Record<string, number> | null
  const bestEval = best?.eval as Record<string, number> | null

  if (playedEval?.cp != null) return playedEval.cp / 100
  if (bestEval?.cp != null) return bestEval.cp / 100
  if (typeof (played as Record<string, unknown>)?.score === 'number') return (played as Record<string, number>).score

  return null
}

function buildEvalPoints(review: Record<string, unknown>, moves?: Array<{ san: string }>) {
  const positions = review.positions as Array<{
    color?: string
    classificationName?: string
    bestMove?: { eval?: { cp?: number }; mateIn?: number | null }
    playedMove?: { eval?: { cp?: number }; score?: number; mateIn?: number | null }
  }> | undefined

  if (!positions) return []

  return positions.map((p, i) => {
    // Get eval from played move or best move
    let evalVal: number | null = null
    if (p.playedMove?.eval?.cp != null) {
      evalVal = p.playedMove.eval.cp / 100
    } else if (p.bestMove?.eval?.cp != null) {
      evalVal = p.bestMove.eval.cp / 100
    } else if (p.playedMove?.score != null) {
      evalVal = p.playedMove.score
    }

    // Handle mate
    if (p.playedMove?.mateIn != null) {
      evalVal = p.playedMove.mateIn > 0 ? 10 : -10
    } else if (p.bestMove?.mateIn != null) {
      evalVal = p.bestMove.mateIn > 0 ? 10 : -10
    }

    return {
      ply: i,
      eval: evalVal,
      san: moves && i > 0 ? moves[i - 1]?.san : undefined,
      classification: normCls(p.classificationName) || undefined,
    }
  })
}

function ReviewPanel({ review, headers }: { review: Record<string, unknown>; headers: GameHeaders | null }) {
  const [expanded, setExpanded] = useState(false)
  const caps = review.CAPS as { white: Record<string, number | null>; black: Record<string, number | null> } | undefined
  const reportCard = review.reportCard as { white?: { effectiveElo?: number }; black?: { effectiveElo?: number } } | undefined
  const positions = review.positions as Array<{ classificationName?: string; color?: string }> | undefined

  if (!caps) return null

  const wName = headers?.White || 'White'
  const bName = headers?.Black || 'Black'

  // Count classifications
  const wCls: Record<string, number> = {}
  const bCls: Record<string, number> = {}
  for (const p of positions || []) {
    const cn = normCls(p.classificationName)
    if (!cn) continue
    if (p.color === 'white') wCls[cn] = (wCls[cn] || 0) + 1
    if (p.color === 'black') bCls[cn] = (bCls[cn] || 0) + 1
  }

  const clsColors: Record<string, string> = {
    brilliant: 'text-cyan-400', great: 'text-[#749BBF]', book: 'text-violet-400',
    best: 'text-emerald-400', excellent: 'text-emerald-300', good: 'text-slate-300',
    forced: 'text-green-400', inaccuracy: 'text-amber-400', mistake: 'text-orange-400',
    miss: 'text-red-400', blunder: 'text-rose-400',
  }

  const minimizedCls = ['brilliant', 'great', 'best', 'mistake', 'miss', 'blunder']
  const allCls = ['brilliant', 'great', 'book', 'best', 'excellent', 'good', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder']
  const visibleCls = expanded ? allCls : minimizedCls

  const fmt = (v: number | null | undefined) => v != null ? v.toFixed(1) : '-'

  const result = headers?.Result || ''
  const whiteWon = result === '1-0'
  const blackWon = result === '0-1'

  return (
    <div className="mt-6 rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm overflow-hidden">
      {/* Players + Accuracy header */}
      <div className="p-4">
        <div className="grid grid-cols-[1fr_140px_1fr] items-center justify-items-center gap-4 mb-4">
          <div className="text-sm font-bold truncate">{wName}</div>
          <div className="text-xs text-muted-foreground">Players</div>
          <div className="text-sm font-bold truncate">{bName}</div>
        </div>
        <div className="grid grid-cols-[1fr_140px_1fr] items-center justify-items-center gap-4 mb-2">
          <div className={`rounded-xl p-0.5 ${whiteWon ? 'ring-2 ring-emerald-500' : ''}`}>
            <PlayerAvatar username={wName} size={48} />
          </div>
          <div />
          <div className={`rounded-xl p-0.5 ${blackWon ? 'ring-2 ring-emerald-500' : ''}`}>
            <PlayerAvatar username={bName} size={48} />
          </div>
        </div>
        {/* Game Rating (effectiveElo) */}
        {(reportCard?.white?.effectiveElo || reportCard?.black?.effectiveElo) && (
          <div className="grid grid-cols-[1fr_140px_1fr] items-center justify-items-center gap-4">
            <span className="text-lg font-bold px-3 py-1 rounded-lg border border-border/60">{reportCard?.white?.effectiveElo || '-'}</span>
            <div className="text-xs text-muted-foreground">Game Rating</div>
            <span className="text-lg font-bold px-3 py-1 rounded-lg border border-border/60">{reportCard?.black?.effectiveElo || '-'}</span>
          </div>
        )}
        <div className="grid grid-cols-[1fr_140px_1fr] items-center justify-items-center gap-4 mt-2">
          <span className={`text-lg font-bold px-3 py-1 rounded-lg ${whiteWon ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted'}`}>{fmt(caps.white.all)}</span>
          <div className="text-xs text-muted-foreground">Accuracy</div>
          <span className={`text-lg font-bold px-3 py-1 rounded-lg ${blackWon ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted'}`}>{fmt(caps.black.all)}</span>
        </div>

        {/* Phase accuracy */}
        {(() => {
          const phases = [['Opening', 'gp0'], ['Middlegame', 'gp1'], ['Endgame', 'gp2']] as const
          const visible = phases.filter(([, k]) => caps.white[k] != null || caps.black[k] != null)
          if (!visible.length) return null
          return (
            <div className="mt-3 pt-3 border-t border-border/30">
              {visible.map(([label, key]) => (
                <div key={key} className="grid grid-cols-[1fr_140px_1fr] items-center gap-4 py-1">
                  <div className="text-center text-sm font-bold">{fmt(caps.white[key])}</div>
                  <div className="text-xs text-muted-foreground min-w-[90px] text-center">{label}</div>
                  <div className="text-center text-sm font-bold">{fmt(caps.black[key])}</div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      {/* Move classifications */}
      <div className="border-t border-border/30">
        {visibleCls.map(c => {
          const w = wCls[c] || 0
          const b = bCls[c] || 0
          return (
            <div key={c} className="grid grid-cols-[1fr_140px_1fr] items-center px-4 py-2.5 border-b border-border/20 last:border-0">
              <div className={`text-center text-sm font-bold ${w ? clsColors[c] : 'text-muted-foreground/30'}`}>{w}</div>
              <div className="flex items-center gap-2 justify-center">
                <img src={`/icons/cls-${c}.svg`} alt={c} className="w-5 h-5 shrink-0" />
                <span className={`text-sm font-medium ${clsColors[c]}`}>{c.charAt(0).toUpperCase() + c.slice(1)}</span>
              </div>
              <div className={`text-center text-sm font-bold ${b ? clsColors[c] : 'text-muted-foreground/30'}`}>{b}</div>
            </div>
          )
        })}

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-2 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={`w-5 h-5 transition-transform ${expanded ? '-rotate-90' : 'rotate-90'}`} />
        </button>
      </div>
    </div>
  )
}

// ─── Move Quality + Fair Play + Piece DNA sections ───

interface PositionData {
  classificationName?: string
  color?: string
  difference?: number
  caps2?: number
}

const MOVE_CATS = [
  { key: 'brilliant', label: 'Brilliant', color: '#00e5ff' },
  { key: 'great', label: 'Great', color: '#8b5cf6' },
  { key: 'best', label: 'Best', color: '#34d399' },
  { key: 'excellent', label: 'Excellent', color: '#22d3ee' },
  { key: 'good', label: 'Good', color: '#a3e635' },
  { key: 'book', label: 'Book', color: '#94a3b8' },
  { key: 'inaccuracy', label: 'Inaccuracy', color: '#fbbf24' },
  { key: 'mistake', label: 'Mistake', color: '#f97316' },
  { key: 'miss', label: 'Miss', color: '#ef4444' },
  { key: 'blunder', label: 'Blunder', color: '#dc2626' },
]


function GameAnalysisSections({ review, headers, orientation }: { review: Record<string, unknown>; headers: GameHeaders | null; orientation: 'white' | 'black' }) {
  const caps = review.CAPS as { white: Record<string, number | null>; black: Record<string, number | null> } | undefined
  const positions = review.positions as PositionData[] | undefined
  if (!caps || !positions) return null

  const wName = headers?.White || 'White'
  const bName = headers?.Black || 'Black'
  const youColor = orientation
  const youName = youColor === 'white' ? wName : bName
  const oppName = youColor === 'white' ? bName : wName

  // Move classification counts per player
  const wCls: Record<string, number> = {}
  const bCls: Record<string, number> = {}
  for (const p of positions) {
    const cn = normCls(p.classificationName)
    if (!cn) continue
    if (p.color === 'white') wCls[cn] = (wCls[cn] || 0) + 1
    if (p.color === 'black') bCls[cn] = (bCls[cn] || 0) + 1
  }

  const youCls = youColor === 'white' ? wCls : bCls
  const oppCls = youColor === 'white' ? bCls : wCls
  const youTotal = Object.values(youCls).reduce((a, b) => a + b, 0) || 1
  const oppTotal = Object.values(oppCls).reduce((a, b) => a + b, 0) || 1

  const youCaps = youColor === 'white' ? caps.white : caps.black
  const oppCaps = youColor === 'white' ? caps.black : caps.white

  // Piece radar — merged
  const pieceLabels: Record<string, string> = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' }
  const pieceKeys = ['K', 'Q', 'R', 'B', 'N', 'P']
  const radarData = pieceKeys.map(k => ({
    piece: pieceLabels[k],
    you: (youCaps[k] as number) || 0,
    opponent: (oppCaps[k] as number) || 0,
    fullMark: 100,
  }))

  return (
    <div className="mt-6 space-y-4">
      <SwitchableCard
        icon={<Eye className="w-4 h-4 text-primary" />}
        title="Move Quality"
        youLabel={youName}
        oppLabel={oppName}
        youContent={<MoveQualityContent cls={youCls} total={youTotal} />}
        oppContent={<MoveQualityContent cls={oppCls} total={oppTotal} />}
        youExtra={<span className="text-xs text-muted-foreground">{youTotal} moves</span>}
        oppExtra={<span className="text-xs text-muted-foreground">{oppTotal} moves</span>}
      />

      <PieceRadarMerged data={radarData} youName={youName} oppName={oppName} />
    </div>
  )
}

function SwitchableCard({ icon, title, youLabel, oppLabel, youContent, oppContent, youExtra, oppExtra }: {
  icon: React.ReactNode; title: string
  youLabel: string; oppLabel: string
  youContent: React.ReactNode; oppContent: React.ReactNode
  youExtra?: React.ReactNode; oppExtra?: React.ReactNode
}) {
  const [active, setActive] = useState<'you' | 'opp'>('you')

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-bold uppercase tracking-wider">{title}</h3>
        </div>
        {active === 'you' ? youExtra : oppExtra}
      </div>
      <div className="flex items-center gap-4 mb-4 border-b border-border/30">
        <button
          onClick={() => setActive('you')}
          className={`pb-2 text-sm font-medium transition-colors relative ${
            active === 'you' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {youLabel}
          {active === 'you' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
        </button>
        <button
          onClick={() => setActive('opp')}
          className={`pb-2 text-sm font-medium transition-colors relative ${
            active === 'opp' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {oppLabel}
          {active === 'opp' && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />}
        </button>
      </div>
      {active === 'you' ? youContent : oppContent}
    </div>
  )
}

function MoveQualityContent({ cls, total }: { cls: Record<string, number>; total: number }) {
  return (
    <>
      <div className="flex h-7 rounded-lg overflow-hidden gap-px mb-3">
        {MOVE_CATS.map(cat => {
          const count = cls[cat.key] || 0
          const pct = (count / total) * 100
          if (pct < 1) return null
          return (
            <div
              key={cat.key}
              className="flex items-center justify-center text-[10px] font-bold text-black/70 min-w-[20px]"
              style={{ width: `${pct}%`, backgroundColor: cat.color }}
            >
              {pct >= 5 ? `${Math.round(pct)}%` : ''}
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {MOVE_CATS.map(cat => {
          const count = cls[cat.key] || 0
          if (!count) return null
          return (
            <span key={cat.key} className="flex items-center gap-1 text-xs">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
              <span className="text-muted-foreground">{cat.label}</span>
              <span className="font-bold">{count}</span>
            </span>
          )
        })}
      </div>
    </>
  )
}


function PieceRadarMerged({ data, youName, oppName }: {
  data: { piece: string; you: number; opponent: number; fullMark: number }[]
  youName: string; oppName: string
}) {
  const hasYou = data.some(d => d.you > 0)
  const hasOpp = data.some(d => d.opponent > 0)
  if (!hasYou && !hasOpp) return null

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-4 sm:p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Dna className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-bold uppercase tracking-wider">Piece Accuracy</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-400" />{youName}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400" />{oppName}</span>
        </div>
      </div>
      <div className="h-[250px] -mx-4" style={{ minWidth: 200, minHeight: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
            <PolarGrid stroke="rgba(255,255,255,0.08)" />
            <PolarAngleAxis dataKey="piece" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 12 }} />
            <Tooltip
              content={({ payload, label }) => {
                if (!payload?.length) return null
                return (
                  <div className="rounded-lg bg-zinc-900 border border-border/60 px-3 py-2 text-xs shadow-lg">
                    <div className="font-semibold mb-1">{label}</div>
                    {payload.map((p: any) => (
                      <div key={p.dataKey} className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-muted-foreground">{p.dataKey === 'you' ? youName : oppName}</span>
                        <span className="font-bold ml-auto">{p.value?.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )
              }}
            />
            {hasYou && <Radar dataKey="you" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.12} strokeWidth={2} />}
            {hasOpp && <Radar dataKey="opponent" stroke="#fb7185" fill="#fb7185" fillOpacity={0.08} strokeWidth={2} />}
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// Format clock: "0:00:31.7" -> "0:31", "1:23:45.0" -> "1:23:45"
function formatClock(raw: string): string {
  const parts = raw.split(':')
  if (parts.length === 3) {
    const h = parseInt(parts[0])
    const m = parseInt(parts[1])
    const s = parseFloat(parts[2])
    const si = Math.floor(s)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(si).padStart(2, '0')}`
    if (m > 0) return `${m}:${String(si).padStart(2, '0')}`
    // Under 1 minute — show seconds with decimal
    return `0:${s < 10 ? '0' : ''}${s.toFixed(1)}`
  }
  return raw
}

function BoardPlayerBar({ name, elo, clock, isActive }: {
  name: string; elo: string; clock?: string; isActive: boolean; color: 'white' | 'black'
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-1">
      <div className="flex items-center gap-2">
        <PlayerAvatar username={name} size={24} />
        <span className="text-sm font-semibold">{name}</span>
        <span className="text-xs text-muted-foreground">({elo})</span>
      </div>
      {clock && (
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-sm font-mono font-bold ${
          isActive ? 'bg-white text-zinc-900' : 'bg-muted/50 text-muted-foreground'
        }`}>
          <Clock className="w-3 h-3" />
          {formatClock(clock)}
        </div>
      )}
    </div>
  )
}

function PlayerInfo({ name, elo, eloDiff, color }: {
  name: string; elo: string; eloDiff?: string; color: 'white' | 'black'
}) {
  const diff = eloDiff ? parseInt(eloDiff) : null
  const diffColor = diff != null && diff > 0 ? 'text-emerald-400' : diff != null && diff < 0 ? 'text-rose-400' : 'text-muted-foreground'
  const diffStr = diff != null ? (diff > 0 ? `+${diff}` : `${diff}`) : null

  return (
    <div className={`flex items-center gap-2 ${color === 'black' ? 'flex-row-reverse text-right' : ''}`}>
      <div className="relative shrink-0">
        <PlayerAvatar username={name} size={28} />
        <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${color === 'white' ? 'bg-white' : 'bg-zinc-700'}`} />
      </div>
      <div>
        <div className="text-sm font-semibold leading-tight">{name}</div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <span>{elo}</span>
          {diffStr && <span className={`font-semibold ${diffColor}`}>{diffStr}</span>}
        </div>
      </div>
    </div>
  )
}

// Unicode chess pieces
const WHITE_PIECES: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' }
const BLACK_PIECES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }

function formatSan(san: string, isWhite: boolean): React.ReactNode {
  if (!san || san.startsWith('O-')) return <>{san}</>
  const pieces = isWhite ? WHITE_PIECES : BLACK_PIECES
  const firstChar = san[0]
  if (pieces[firstChar]) {
    return <><span className="text-lg leading-none">{pieces[firstChar]}</span>{san.slice(1)}</>
  }
  return <>{san}</>
}

const CLS_TEXT_COLOR: Record<string, string> = {
  brilliant: 'text-cyan-400', great: 'text-[#749BBF]', best: 'text-emerald-400', excellent: 'text-emerald-300',
  good: '', book: 'text-violet-400', forced: 'text-green-400',
  inaccuracy: 'text-amber-400', mistake: 'text-orange-400', miss: 'text-red-400', blunder: 'text-rose-400',
}

function MoveCell({ san, isActive, onClick, ply, classification, isWhite, isPlayer }: {
  san?: string; isActive: boolean; onClick: () => void; ply: number; classification?: string; isWhite?: boolean; isPlayer?: boolean
}) {
  if (!san) return <div className="flex-1" />
  const isCapture = san?.includes('x') || false
  const showIcon = classification && !['good', 'excellent'].includes(classification) && !(classification === 'best' && !(isCapture && isPlayer))
  const clsColor = classification ? CLS_TEXT_COLOR[classification] || '' : ''
  return (
    <div
      data-ply={ply}
      onClick={onClick}
      className={`flex-1 flex items-center px-2 py-1 rounded cursor-pointer transition-colors ${
        isActive ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50'
      }`}
    >
      <div className="flex items-center gap-1">
        {showIcon && (
          <img src={`/icons/cls-${classification}.svg`} alt="" className="w-3.5 h-3.5 shrink-0" />
        )}
        <span className={`font-mono text-sm ${showIcon ? clsColor : ''}`}>{formatSan(san, isWhite ?? true)}</span>
      </div>
    </div>
  )
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg bg-muted/50 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors active:scale-95"
    >
      {children}
    </button>
  )
}
