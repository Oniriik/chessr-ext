'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, ScrollText, Layers, LogOut, Menu, X, Server,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
// Legacy CSS — still consumed by /queues and /logs (admin-card etc).
// Will be removed once those pages are migrated to shadcn components.
import './admin-shell.css';

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
};

// Trimmed nav: Live (default), Queues, Logs. /metrics + /users folded into
// /live so there's a single place to glance at the system.
const NAV_ITEMS: NavItem[] = [
  { href: '/live',    label: 'Live',    icon: Activity   },
  { href: '/queues',  label: 'Queues',  icon: Layers     },
  { href: '/logs',    label: 'Logs',    icon: ScrollText },
];

export function AdminShell({ children, title }: { children: ReactNode; title?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace('/login'); return; }
      setUserEmail(data.session.user.email || null);
    })();
  }, [router]);

  // Close mobile drawer on navigation.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }

  const initial = userEmail?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* ─── Mobile top bar ───────────────────────────────────────────── */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card/60 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="text-sm font-semibold tracking-tight">
            Chessr <span className="text-primary">v3</span>
          </span>
        </div>
        <button
          aria-label="Toggle nav"
          onClick={() => setMobileOpen((v) => !v)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </header>

      {/* ─── Mobile drawer (overlay) ──────────────────────────────────── */}
      {mobileOpen && (
        <div className="border-b border-border bg-card md:hidden">
          <nav className="flex flex-col p-2">
            {NAV_ITEMS.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + '/');
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                    active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon size={16} strokeWidth={2} />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary">
                {initial}
              </div>
              <span className="truncate text-xs text-muted-foreground" title={userEmail ?? ''}>{userEmail}</span>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut size={12} />
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* ─── Desktop sidebar ──────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-5">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.4)]" />
          <span className="text-sm font-semibold tracking-tight">
            Chessr <span className="text-primary">v3</span>
          </span>
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {NAV_ITEMS.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + '/');
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
                  active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon size={15} strokeWidth={2} />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          {userEmail && (
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-semibold text-primary">
                {initial}
              </div>
              <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={userEmail}>
                {userEmail}
              </div>
            </div>
          )}
          <button
            onClick={signOut}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut size={12} strokeWidth={2.2} />
            Sign out
          </button>
        </div>
      </aside>

      {/* ─── Main content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-x-hidden">
        {title && (
          <header className="border-b border-border px-4 py-4 sm:px-6 sm:py-5">
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1>
          </header>
        )}
        <div className="p-4 sm:p-6">{children}</div>
      </main>
    </div>
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
