'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, BarChart3, Gift, Globe, Layers, LayoutDashboard, LogOut,
  Menu, MessageSquare, ScrollText, Server, Sparkles, Users,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
// Legacy CSS — still consumed by /queues and /logs (admin-card etc).
// Will be removed once those pages are migrated to shadcn components.
import './admin-shell.css';

type NavItem = { href: string; label: string; icon: typeof Activity };
type NavSection = { label: string; items: NavItem[] };

// Sidebar grouped by workflow category. Items inside a section are
// ordered roughly by daily-use frequency. Adding a section: append
// here, the renderer picks it up automatically.
const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { href: '/',          label: 'Dashboard', icon: LayoutDashboard },
      { href: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Users',
    items: [
      { href: '/users',        label: 'All users', icon: Users },
      { href: '/users/globe',  label: 'Globe',     icon: Globe },
    ],
  },
  {
    label: 'Discord',
    items: [
      { href: '/discord/wheel',     label: 'Wheel Spin', icon: Sparkles },
      { href: '/discord/giveaways', label: 'Giveaways',  icon: Gift },
      { href: '/messages',          label: 'Messages',   icon: MessageSquare },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/live',    label: 'Live',    icon: Activity   },
      { href: '/metrics', label: 'Metrics', icon: BarChart3  },
      { href: '/logs',    label: 'Logs',    icon: ScrollText },
      { href: '/queues',  label: 'Queues',  icon: Layers     },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
      <span className="text-[13px] font-semibold tracking-tight">
        chessr<span className="text-primary/90">.io</span>
      </span>
    </div>
  );
}

function NavLinks({
  pathname,
  onSelect,
  badges,
}: {
  pathname: string;
  onSelect?: () => void;
  badges?: Record<string, number>;
}) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="flex flex-col gap-1">
          <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
            {section.label}
          </div>
          {section.items.map((n) => {
            // `/` activeté seulement quand exact — sinon ça matcherait toutes les routes.
            const active = n.href === '/'
              ? pathname === '/'
              : pathname === n.href || pathname.startsWith(n.href + '/');
            const Icon = n.icon;
            const badge = badges?.[n.href] ?? 0;
            return (
              <Link
                key={n.href}
                href={n.href}
                onClick={onSelect}
                className={cn(
                  'group flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                  active
                    ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon size={15} strokeWidth={2} className={cn('shrink-0 transition-transform', active && 'scale-105')} />
                <span className="flex-1">{n.label}</span>
                {badge > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/90 px-1 text-[10px] font-semibold text-white">
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title?: string;
  /** Optional right-aligned content next to the title (e.g. quick links). */
  actions?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Sidebar badges. Fetched on mount + every 30s. The map is keyed
  // by nav href so each section can quietly add its own indicator
  // without changing AdminShell internals later.
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace('/login'); return; }
      setUserEmail(data.session.user.email || null);
    })();
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const supabase = getSupabase();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch(`/api/admin/wheel/pending-lifetime/count?token=${encodeURIComponent(token)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { count?: number };
        if (cancelled) return;
        setBadges((prev) => ({ ...prev, '/discord/wheel': json.count ?? 0 }));
      } catch { /* badges are best-effort */ }
    }
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Close mobile drawer on navigation.
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }

  const initial = userEmail?.[0]?.toUpperCase() ?? '?';

  return (
    <TooltipProvider delayDuration={250}>
      {/* Outer is locked to viewport height so children can use h-full
       *  for in-content scrollers (e.g. the log tail on /logs).
       *  `dvh` handles mobile address-bar-collapse correctly. */}
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        {/* ─── Mobile top bar ───────────────────────────────────────────── */}
        <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-4 py-3 backdrop-blur-md md:hidden">
          <Brand />
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu size={18} />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 border-border/80">
              <SheetHeader className="mb-4">
                <SheetTitle className="flex items-center gap-2">
                  <Brand />
                </SheetTitle>
              </SheetHeader>
              <NavLinks pathname={pathname} onSelect={() => setSheetOpen(false)} badges={badges} />
              <Separator className="my-4" />
              {userEmail && (
                <div className="flex items-center gap-3 px-1">
                  <Avatar className="h-8 w-8 bg-primary/10 ring-1 ring-inset ring-primary/20 text-primary">
                    <AvatarFallback className="bg-transparent text-primary">{initial}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{userEmail}</div>
                    <div className="text-[10px] text-muted-foreground">Admin</div>
                  </div>
                </div>
              )}
              <Button variant="outline" size="sm" className="mt-4 w-full" onClick={signOut}>
                <LogOut size={13} />
                Sign out
              </Button>
            </SheetContent>
          </Sheet>
        </header>

        {/* ─── Desktop sidebar ──────────────────────────────────────────── */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border/50 bg-card/30 backdrop-blur-sm md:flex">
          <div className="flex h-14 items-center border-b border-border/50 px-6">
            <Brand />
          </div>

          {/* All sidebar children share a 24px left-inset:
           *   brand:    px-6 (24)
           *   nav:      parent px-3 + item px-3 → icon at 24
           *   "Navigation" caps label: px-3 inside parent px-3 → 24
           *   user block: px-6 (24)
           */}
          <div className="flex-1 overflow-y-auto px-3 py-4">
            <NavLinks pathname={pathname} badges={badges} />
          </div>

          <Separator className="bg-border/40" />

          <div className="flex items-center gap-3 px-6 py-3">
            {userEmail && (
              <>
                <Avatar className="h-8 w-8 bg-gradient-to-br from-primary/30 to-primary/10 text-primary">
                  <AvatarFallback className="bg-transparent text-primary">{initial}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] font-medium leading-tight">{userEmail}</div>
                  <div className="text-[10px] text-muted-foreground">Admin</div>
                </div>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8">
                  <LogOut size={14} strokeWidth={2.2} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Sign out</TooltipContent>
            </Tooltip>
          </div>
        </aside>

        {/* ─── Main ─────────────────────────────────────────────────────── */}
        {/* `flex flex-col` + `min-h-0 flex-1` body lets pages that need a
         *  full-height inner scroller (e.g. /logs) fill the viewport
         *  without creating a window-level scrollbar. Pages with normal
         *  flow (/live, /queues) just sit at the top and let the body
         *  div's available space stay empty below. */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {title && (
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-background/40 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-5">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </header>
          )}
          {/* Body div: fixed height = main minus header.
           *  - Pages with normal flow (/live, /queues): content longer
           *    than the body? body div scrolls (overflow-y-auto).
           *  - Pages that need an inner scroller (/logs): set their root
           *    child to `h-full flex flex-col`; the inner scroll element
           *    handles overflow, body div stays exact-size. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}

export function ServerStatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-destructive/30 bg-destructive/10 text-destructive',
      )}
    >
      <Server size={11} strokeWidth={2.5} />
      {ok ? 'live' : 'offline'}
    </span>
  );
}
