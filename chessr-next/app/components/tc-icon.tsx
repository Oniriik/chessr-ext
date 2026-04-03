import { Crosshair, Zap, Clock, type LucideProps } from 'lucide-react'

const TC_COMPONENTS: Record<string, React.FC<LucideProps>> = {
  bullet: Crosshair,
  blitz: Zap,
  rapid: Clock,
}

const TC_COLORS: Record<string, string> = {
  bullet: 'text-rose-400',
  blitz: 'text-amber-400',
  rapid: 'text-sky-400',
}

export function TcIcon({ tc, className, colored }: { tc: string; className?: string; colored?: boolean }) {
  const Icon = TC_COMPONENTS[tc]
  if (!Icon) return null
  return <Icon className={`${className || 'w-4 h-4'}${colored ? ` ${TC_COLORS[tc]}` : ''}`} />
}

export const TC_LABELS: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
}
