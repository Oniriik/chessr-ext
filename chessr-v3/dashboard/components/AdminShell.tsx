'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Activity, BarChart3, ScrollText, Users, Server, Layers, LogOut,
} from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import './admin-shell.css';

type NavItem = {
  href: string;
  label: string;
  icon: typeof Activity;
  group: 'Monitor' | 'Manage' | 'Users';
};

const NAV_ITEMS: NavItem[] = [
  { href: '/live',    label: 'Live',         icon: Activity,    group: 'Monitor' },
  { href: '/metrics', label: 'Metrics',      icon: BarChart3,   group: 'Monitor' },
  { href: '/queues',  label: 'Queues',       icon: Layers,      group: 'Manage'  },
  { href: '/logs',    label: 'Logs',         icon: ScrollText,  group: 'Manage'  },
  { href: '/users',   label: 'Connected',    icon: Users,       group: 'Users'   },
];

const GROUPS: NavItem['group'][] = ['Monitor', 'Manage', 'Users'];

export function AdminShell({ children, title }: { children: ReactNode; title?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace('/login'); return; }
      setUserEmail(data.session.user.email || null);
    })();
  }, [router]);

  async function signOut() {
    await getSupabase().auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-dot" />
          <strong>Chessr <span className="admin-brand-accent">v3</span></strong>
        </div>

        <nav className="admin-nav">
          {GROUPS.map((group) => (
            <div key={group} className="admin-nav-group">
              <div className="admin-nav-group-label">{group}</div>
              {NAV_ITEMS.filter((n) => n.group === group).map((n) => {
                const active = pathname === n.href || pathname.startsWith(n.href + '/');
                const Icon = n.icon;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`admin-nav-item${active ? ' admin-nav-item--active' : ''}`}
                  >
                    <Icon size={15} strokeWidth={2} />
                    <span>{n.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          {userEmail && (
            <div className="admin-user">
              <div className="admin-user-avatar">{userEmail[0]?.toUpperCase() ?? '?'}</div>
              <div className="admin-user-email" title={userEmail}>{userEmail}</div>
            </div>
          )}
          <button className="admin-signout" onClick={signOut}>
            <LogOut size={14} strokeWidth={2} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        {title && (
          <header className="admin-page-header">
            <h1>{title}</h1>
          </header>
        )}
        <div className="admin-page-body">{children}</div>
      </main>
    </div>
  );
}

export function ServerStatusBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`admin-status-badge${ok ? ' admin-status-badge--ok' : ' admin-status-badge--err'}`}>
      <Server size={11} strokeWidth={2.5} />
      {ok ? 'live' : 'offline'}
    </span>
  );
}
