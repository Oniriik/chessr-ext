'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Loader2, AlertTriangle, ChevronDown, Copy, Check } from 'lucide-react'
import { TcIcon } from '@/components/tc-icon'
import { PlayerAvatar } from '@/components/player-avatar'
import { AccountSelector } from '@/components/account-selector'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface LinkedAccount {
  id: string
  platform: string
  platform_username: string
  avatar_url: string | null
  rating_blitz: number | null
  rating_rapid: number | null
  rating_bullet: number | null
}

interface ChessComGame {
  url: string
  pgn: string
  time_control: string
  time_class: string
  end_time: number
  rated: boolean
  accuracies?: { white: number; black: number }
  white: { username: string; rating: number; result: string }
  black: { username: string; rating: number; result: string }
}

export default function HomePage() {
  // Linked accounts
  const [accounts, setAccounts] = useState<LinkedAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const [accountsLoading, setAccountsLoading] = useState(true)

  // Games
  const [games, setGames] = useState<ChessComGame[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [archives, setArchives] = useState<string[]>([])
  const [archiveIndex, setArchiveIndex] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const loadMoreRef = useRef<HTMLDivElement>(null)

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
      } catch {
        // ignore
      } finally {
        setAccountsLoading(false)
      }
    }
    fetchAccounts()
  }, [])

  // Fetch archives when account changes
  useEffect(() => {
    if (!selectedAccount) return
    setGames([])
    setArchives([])
    setArchiveIndex(0)
    setHasMore(true)
    setGamesLoading(true)

    async function fetchArchives() {
      try {
        const res = await fetch(`https://api.chess.com/pub/player/${selectedAccount}/games/archives`, {
          headers: { 'User-Agent': 'Chessr/1.0' },
        })
        const data = await res.json()
        const allArchives = (data.archives || []).reverse() // newest first
        setArchives(allArchives)
        if (allArchives.length > 0) {
          await loadGamesFromArchive(allArchives[0], true)
          setArchiveIndex(1)
        } else {
          setHasMore(false)
        }
      } catch {
        setHasMore(false)
      } finally {
        setGamesLoading(false)
      }
    }
    fetchArchives()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount])

  // Load games from a specific archive URL
  const loadGamesFromArchive = useCallback(async (archiveUrl: string, replace = false) => {
    try {
      const res = await fetch(archiveUrl, { headers: { 'User-Agent': 'Chessr/1.0' } })
      const data = await res.json()
      const liveGames = (data.games || [])
        .filter((g: ChessComGame) => g.url?.includes('/live/'))
        .reverse() // newest first
      setGames(prev => replace ? liveGames : [...prev, ...liveGames])
    } catch {
      // ignore
    }
  }, [])

  // Load more games (next archive)
  const loadMore = useCallback(async () => {
    if (gamesLoading || !hasMore || archiveIndex >= archives.length) {
      setHasMore(false)
      return
    }
    setGamesLoading(true)
    await loadGamesFromArchive(archives[archiveIndex])
    setArchiveIndex(prev => prev + 1)
    if (archiveIndex + 1 >= archives.length) setHasMore(false)
    setGamesLoading(false)
  }, [gamesLoading, hasMore, archiveIndex, archives, loadGamesFromArchive])

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMore && !gamesLoading) loadMore() },
      { threshold: 0.1 }
    )
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [hasMore, gamesLoading, loadMore])

  return (
    <main className="max-w-2xl sm:max-w-3xl lg:max-w-5xl mx-auto px-4 py-6">
        {/* Warning banner */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm mb-6">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>We are only supporting Chess.com games for now</span>
        </div>

        {/* Account selector */}
        {(accountsLoading || (accounts.length > 0 && games.length === 0 && gamesLoading)) ? (
          <div className="space-y-4">
            {/* Account selector skeleton */}
            <div className="flex items-center gap-2">
              <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" />
              <div className="h-8 w-36 bg-muted rounded-xl animate-pulse" />
            </div>
            {/* Game list skeleton */}
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card/30 border border-border/30">
                  <div className="w-1.5 h-10 bg-muted rounded-full animate-pulse shrink-0" />
                  <div className="flex items-center shrink-0">
                    <div className="w-8 h-8 bg-muted rounded-full animate-pulse" />
                    <div className="w-8 h-8 bg-muted rounded-full animate-pulse -ml-2" />
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-52 bg-muted rounded animate-pulse" />
                    <div className="h-3 w-32 bg-muted/60 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-10 bg-muted rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-2">No Chess.com accounts linked</p>
            <p className="text-sm text-muted-foreground">Link your Chess.com account in the Chessr extension first.</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <AccountSelector accounts={accounts} selected={selectedAccount} onSelect={setSelectedAccount} />
            </div>

            {/* Games list */}
            <div className="space-y-2">
              {games.map((game) => (
                <GameRow key={game.url} game={game} username={selectedAccount!} />
              ))}
            </div>

            {/* Loading / load more */}
            <div ref={loadMoreRef} className="py-6 flex justify-center">
              {gamesLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
              {!gamesLoading && hasMore && (
                <button onClick={loadMore} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                  <ChevronDown className="w-4 h-4" /> Load more games
                </button>
              )}
              {!hasMore && games.length > 0 && (
                <span className="text-xs text-muted-foreground">No more games</span>
              )}
            </div>
          </>
        )}

    </main>
  )
}

function GameRow({ game, username }: { game: ChessComGame; username: string }) {
  const [copied, setCopied] = useState(false)
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase()
  const player = isWhite ? game.white : game.black
  const opponent = isWhite ? game.black : game.white
  const playerResult = player.result
  const lossResults = ['checkmated', 'timeout', 'resigned', 'abandoned', 'lose']
  const resultLabel = playerResult === 'win' ? 'Win' : lossResults.includes(playerResult) ? 'Loss' : 'Draw'
  const resultColor = resultLabel === 'Win' ? 'text-emerald-400' : resultLabel === 'Loss' ? 'text-rose-400' : 'text-amber-400'
  const resultBorderColor = resultLabel === 'Win' ? 'border-l-emerald-500' : resultLabel === 'Loss' ? 'border-l-rose-500' : 'border-l-amber-500'

  const gameId = game.url.split('/').pop()
  const date = new Date(game.end_time * 1000)
  const timeAgo = getTimeAgo(date)

  const timeClass = game.time_class

  const playerAccuracy = game.accuracies ? (isWhite ? game.accuracies.white : game.accuracies.black) : null
  const opponentAccuracy = game.accuracies ? (isWhite ? game.accuracies.black : game.accuracies.white) : null

  const handleCopyPgn = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(game.pgn).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  function AccuracyBar({ value }: { value: number }) {
    const color = value >= 90 ? 'bg-emerald-400' : value >= 70 ? 'bg-sky-400' : value >= 50 ? 'bg-amber-400' : 'bg-rose-400'
    return (
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    )
  }

  const playerWon = playerResult === 'win'
  const opponentWon = opponent.result === 'win'
  const isDraw = resultLabel === 'Draw'
  const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  // Result indicator: green square = win, red = loss, grey = draw
  const resultSquareColor = playerWon ? 'bg-emerald-500' : isDraw ? 'bg-zinc-500' : 'bg-rose-500'
  const glowColor = playerWon ? 'emerald' : isDraw ? 'zinc' : 'rose'

  return (
    <div
      className="relative flex items-center gap-3 px-3 py-2.5 rounded-xl bg-card/30 border border-border/30 hover:border-border/50 cursor-pointer group overflow-hidden"
      style={{
        '--glow': playerWon ? '16,185,129' : isDraw ? '161,161,170' : '244,63,94',
      } as React.CSSProperties}
      onClick={() => {
        sessionStorage.setItem(`pgn-${gameId}`, game.pgn)
        window.open(`/review/${gameId}`, '_blank')
      }}
    >
      {/* Result indicator square */}
      <div className={`relative z-10 w-1.5 h-10 rounded-full shrink-0 ${resultSquareColor}`} />

      {/* Player avatars */}
      <div className="relative z-10 flex items-center shrink-0">
        <PlayerAvatar username={player.username} size={32} />
        <div className="-ml-2">
          <PlayerAvatar username={opponent.username} size={32} />
        </div>
      </div>

      {/* Names + rating */}
      <div className="relative z-10 min-w-0 flex-1">
        <div className="flex items-center gap-1 text-sm">
          <span className="font-bold truncate">{player.username}</span>
          <span className="text-muted-foreground text-xs">({player.rating})</span>
          <span className="text-muted-foreground text-xs mx-0.5">vs</span>
          <span className="font-medium truncate">{opponent.username}</span>
          <span className="text-muted-foreground text-xs">({opponent.rating})</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
          <span className="flex items-center gap-1"><TcIcon tc={timeClass} className="w-3 h-3" colored /> {timeClass}</span>
          <span>•</span>
          <span>{formattedDate}</span>
        </div>
      </div>

      {/* Result + actions */}
      <div className="relative z-10 flex items-center gap-2 shrink-0">
        <span className={`text-sm font-bold ${resultColor} w-10 text-right`}>{resultLabel}</span>
        <div className={`w-2.5 h-2.5 rounded-full border ${isWhite ? 'bg-white border-white/30' : 'bg-zinc-700 border-zinc-500'}`} />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopyPgn}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted/50 opacity-0 group-hover:opacity-100"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{copied ? 'Copied!' : 'Copy PGN'}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={game.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted/50 opacity-0 group-hover:opacity-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </TooltipTrigger>
            <TooltipContent side="top">Open on Chess.com</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
