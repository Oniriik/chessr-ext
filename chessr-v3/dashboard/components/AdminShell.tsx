'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, ScrollText, Layers, LogOut, Menu, Server } from 'lucide-react';
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

const NAV_ITEMS: NavItem[] = [
  { href: '/live',    label: 'Live',    icon: Activity   },
  { href: '/queues',  label: 'Queues',  icon: Layers     },
  { href: '/logs',    label: 'Logs',    icon: ScrollText },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative inline-block h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
      <span className="text-[13px] font-semibold tracking-tight">
        Chessr <span className="text-primary/90">v3</span>
      </span>
    </div>
  );
}

function NavLinks({ pathname, onSelect }: { pathname: string; onSelect?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + '/');
        const Icon = n.icon;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onSelect}
            className={cn(
              'group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon size={15} strokeWidth={2} className={cn('shrink-0 transition-transform', active && 'scale-105')} />
            <span>{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children, title }: { children: ReactNode; title?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace('/login'); return; }
      setUserEmail(data.session.user.email || null);
    })();
  }, [router]);

  // Close mobile drawer on navigation.
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }

  const initial = userEmail?.[0]?.toUpperCase() ?? '?';

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-screen flex-col md:flex-row">
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
              <NavLinks pathname={pathname} onSelect={() => setSheetOpen(false)} />
              <Separator className="my-4" />
              {userEmail && (
                <div className="flex items-center gap-2.5 px-1">
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
          <div className="flex h-14 items-center border-b border-border/50 px-5">
            <Brand />
          </div>

          <div className="flex-1 px-3 py-4">
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
              Navigation
            </div>
            <NavLinks pathname={pathname} />
          </div>

          <Separator className="bg-border/40" />

          <div className="flex items-center gap-2.5 p-3">
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
        <main className="min-w-0 flex-1 overflow-x-hidden">
          {title && (
            <header className="border-b border-border/50 bg-background/40 px-4 py-4 backdrop-blur-sm sm:px-6 sm:py-5">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h1>
            </header>
          )}
          <div className="p-4 sm:p-6">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}

export function ServerStatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium',
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
