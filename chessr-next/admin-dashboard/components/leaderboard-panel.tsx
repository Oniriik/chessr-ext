'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Loader2, MessageSquare, Trophy } from 'lucide-react'

type RatingType = 'bullet' | 'blitz' | 'rapid'

interface LeaderboardEntry {
  user_id: string
  email: string
  discord_username: string | null
  rating: number
  platform: string
  platform_username: string
}

const RATING_TYPES: { value: RatingType; label: string; icon: string }[] = [
  { value: 'bullet', label: 'Bullet', icon: '⚡' },
  { value: 'blitz', label: 'Blitz', icon: '🔥' },
  { value: 'rapid', label: 'Rapid', icon: '🕐' },
]

export function LeaderboardPanel() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [ratingType, setRatingType] = useState<RatingType>('blitz')
  const [discordOnly, setDiscordOnly] = useState(false)

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        type: ratingType,
        limit: '50',
      })
      if (discordOnly) params.set('discord_only', 'true')

      const res = await fetch(`/api/leaderboard?${params}`)
      if (res.ok) {
        const data = await res.json()
        setEntries(data.leaderboard || [])
      }
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err)
    } finally {
      setLoading(false)
    }
  }, [ratingType, discordOnly])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  const platformLabel = (platform: string) =>
    platform === 'chesscom' ? 'Chess.com' : 'Lichess'

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Rating type tabs */}
        <div className="flex rounded-lg border border-border/50 overflow-hidden">
          {RATING_TYPES.map((rt) => (
            <button
              key={rt.value}
              onClick={() => setRatingType(rt.value)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                ratingType === rt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted/50 text-muted-foreground'
              }`}
            >
              <span className="mr-1.5">{rt.icon}</span>
              {rt.label}
            </button>
          ))}
        </div>

        {/* Discord filter */}
        <Button
          variant={discordOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDiscordOnly(!discordOnly)}
          className="h-9 text-xs gap-1"
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Discord only
        </Button>

        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={fetchLeaderboard} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Leaderboard */}
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <CardTitle>
              {RATING_TYPES.find((r) => r.value === ratingType)?.icon}{' '}
              {RATING_TYPES.find((r) => r.value === ratingType)?.label} Leaderboard
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length > 0 ? (
            <div className="space-y-1.5">
              {/* Header */}
              <div className="hidden sm:grid grid-cols-[40px_1fr_120px_100px] gap-3 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <span>#</span>
                <span>Player</span>
                <span>Platform</span>
                <span className="text-right">Rating</span>
              </div>

              {entries.map((entry, i) => (
                <div
                  key={entry.user_id}
                  className={`flex sm:grid sm:grid-cols-[40px_1fr_120px_100px] items-center gap-3 p-3 rounded-lg transition-colors ${
                    i === 0 ? 'bg-yellow-500/10 border border-yellow-500/20' :
                    i === 1 ? 'bg-gray-400/10 border border-gray-400/20' :
                    i === 2 ? 'bg-amber-700/10 border border-amber-700/20' :
                    'bg-muted/20 hover:bg-muted/40'
                  }`}
                >
                  {/* Rank */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                    i === 1 ? 'bg-gray-400/20 text-gray-300' :
                    i === 2 ? 'bg-amber-700/20 text-amber-600' :
                    'bg-muted/50 text-muted-foreground'
                  }`}>
                    {i + 1}
                  </div>

                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    {!discordOnly && entry.email && (
                      <span className="text-sm truncate block">{entry.email}</span>
                    )}
                    {entry.discord_username && (
                      <span className={`text-indigo-400 truncate block ${discordOnly ? 'text-sm font-medium' : 'text-xs'}`}>
                        @{entry.discord_username}
                      </span>
                    )}
                    {!entry.discord_username && discordOnly && (
                      <span className="text-sm text-muted-foreground">Unknown</span>
                    )}
                    {/* Mobile: show platform inline */}
                    <div className="sm:hidden flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {platformLabel(entry.platform)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{entry.platform_username}</span>
                    </div>
                  </div>

                  {/* Platform (desktop) */}
                  <div className="hidden sm:flex items-center gap-1.5">
                    <Badge variant="outline" className="text-xs">
                      {platformLabel(entry.platform)}
                    </Badge>
                    <span className="text-xs text-muted-foreground truncate">{entry.platform_username}</span>
                  </div>

                  {/* Rating */}
                  <div className={`text-right font-mono font-bold shrink-0 ${
                    i === 0 ? 'text-yellow-400 text-lg' :
                    i === 1 ? 'text-gray-300 text-lg' :
                    i === 2 ? 'text-amber-600 text-lg' :
                    'text-foreground'
                  }`}>
                    {entry.rating}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No ratings found for this category</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
