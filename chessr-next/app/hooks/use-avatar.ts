'use client'

import { useState, useEffect } from 'react'

const cache = new Map<string, string | null>()

export function useAvatar(username: string | undefined): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(cache.get(username || '') ?? null)
  const [loading, setLoading] = useState(!cache.has(username || ''))

  useEffect(() => {
    if (!username) return

    if (cache.has(username)) {
      setUrl(cache.get(username)!)
      setLoading(false)
      return
    }

    let cancelled = false

    fetch(`https://api.chess.com/pub/player/${username.toLowerCase()}`, {
      headers: { 'User-Agent': 'Chessr/1.0' },
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const avatarUrl = data.avatar || null
        cache.set(username, avatarUrl)
        setUrl(avatarUrl)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        cache.set(username, null)
        setUrl(null)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [username])

  return { url, loading }
}
