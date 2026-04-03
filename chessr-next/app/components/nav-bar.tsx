'use client'

import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { LogOut, Sparkles } from 'lucide-react'
import Link from 'next/link'

const NAV_ITEMS = [
  { href: '/', label: 'Games' },
  { href: '/profile-analysis', label: 'Analysis' },
]

interface NavBarProps {
  userEmail?: string
  reviewLimit?: { isLimited: boolean; dailyUsage: number; dailyLimit: number | null } | null
  animatedBg?: boolean
  onToggleBg?: () => void
}

export function NavBar({ userEmail, reviewLimit, animatedBg, onToggleBg }: NavBarProps) {
  const pathname = usePathname()
  const router = useRouter()

  return (
    <header className="sticky top-0 z-50 bg-background/60 backdrop-blur-xl">
      <div className="w-full px-4 sm:px-6 h-12 sm:h-14 flex items-center justify-between">
        <div className="flex items-center gap-3 sm:gap-6">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <img src="/icon.png" alt="Chessr" className="w-6 h-6 sm:w-8 sm:h-8" />
            <span className="text-lg sm:text-xl font-bold hidden sm:inline">
              <span className="text-white">chessr</span><span className="gradient-text">.io</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-foreground bg-muted'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-1 sm:gap-3">
          {reviewLimit?.isLimited && reviewLimit.dailyLimit != null && (
            <span className="text-xs font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground hidden sm:block">
              Reviews: {reviewLimit.dailyUsage}/{reviewLimit.dailyLimit}
            </span>
          )}
          <span className="text-sm text-muted-foreground hidden md:block truncate max-w-[200px]">{userEmail}</span>
          {onToggleBg && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleBg}
              title={animatedBg ? 'Disable background animation' : 'Enable background animation'}
              className={`h-8 w-8 p-0 ${animatedBg ? 'text-primary' : 'text-muted-foreground'}`}
            >
              <Sparkles className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  )
}
