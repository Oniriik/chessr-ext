'use client'

import { useAvatar } from '@/hooks/use-avatar'

interface Props {
  username: string
  size?: number
  className?: string
}

export function PlayerAvatar({ username, size = 32, className = '' }: Props) {
  const { url, loading } = useAvatar(username)

  const sizeClass = `shrink-0 rounded-lg overflow-hidden bg-muted`
  const style = { width: size, height: size }

  if (loading) {
    return (
      <div className={`${sizeClass} animate-pulse ${className}`} style={style} />
    )
  }

  if (!url) {
    // Fallback: initials
    return (
      <div className={`${sizeClass} flex items-center justify-center text-muted-foreground font-bold ${className}`} style={{ ...style, fontSize: size * 0.4 }}>
        {username.charAt(0).toUpperCase()}
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={username}
      className={`${sizeClass} ${className}`}
      style={style}
      loading="lazy"
    />
  )
}
