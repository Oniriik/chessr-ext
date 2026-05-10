'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AdminShell } from '@/components/AdminShell';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/roles';
import { PendingLifetime } from '@/components/discord/PendingLifetime';
import { Overview } from '@/components/discord/Overview';
import { TokensTab } from '@/components/discord/TokensTab';
import { SpinsTab } from '@/components/discord/SpinsTab';
import { GiftsTab } from '@/components/discord/GiftsTab';
import { ClaimsTab } from '@/components/discord/ClaimsTab';

type Tab = 'overview' | 'tokens' | 'spins' | 'gifts' | 'claims' | 'pending-lifetime';

const TABS: { id: Tab; label: string; badge?: 'alert' }[] = [
  { id: 'overview',          label: 'Overview' },
  { id: 'tokens',            label: 'Tokens' },
  { id: 'spins',             label: 'Spins' },
  { id: 'gifts',             label: 'Gifts' },
  { id: 'claims',            label: 'Claims' },
  { id: 'pending-lifetime',  label: 'Pending Lifetime', badge: 'alert' },
];

export default function WheelAdminPage() {
  // useSearchParams CSR-bails out the page if not wrapped in Suspense
  // — Next.js 15 hard-fails the static export otherwise.
  return (
    <Suspense fallback={<AdminShell title="Wheel Spin">{null}</AdminShell>}>
      <WheelAdminInner />
    </Suspense>
  );
}

function WheelAdminInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialTab = (params.get('tab') as Tab) || 'pending-lifetime';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [callerRole, setCallerRole] = useState<UserRole>('user');
  const [pendingCount, setPendingCount] = useState<number>(0);

  // Mirror the active tab into the URL so reload + share-link land on
  // the same view.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') !== tab) {
      url.searchParams.set('tab', tab);
      router.replace(url.pathname + url.search);
    }
  }, [tab, router]);

  useEffect(() => {
    (async () => {
      const sb = getSupabase();
      const { data: sess } = await sb.auth.getSession();
      if (!sess.session) return;
      const res = await fetch('/api/auth/check-role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: sess.session.user.id }),
      }).catch(() => null);
      if (!res) return;
      const json = await res.json();
      if (json.role) setCallerRole(json.role as UserRole);
    })();
  }, []);

  // Live count for the Pending Lifetime tab badge.
  useEffect(() => {
    let cancelled = false;
    async function fetchCount() {
      const sb = getSupabase();
      const { data: sess } = await sb.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const res = await fetch(`/api/admin/wheel/pending-lifetime/count?token=${encodeURIComponent(token)}`)
        .catch(() => null);
      if (!res || cancelled) return;
      const json = await res.json().catch(() => ({}));
      setPendingCount(json.count ?? 0);
    }
    fetchCount();
    const id = setInterval(fetchCount, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <AdminShell title="Wheel Spin">
      <div className="flex flex-col gap-4">
        {/* ─── Tabs ────────────────────────────────────────────────── */}
        {/* Desktop: pill bar.  Mobile (<sm): segmented scroller with
            x-overflow so all 6 tabs stay reachable on a thumb-width screen. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
          <div role="tablist" className="inline-flex min-w-full gap-1 rounded-md border border-border bg-card/40 p-1 sm:min-w-0">
            {TABS.map((t) => {
              const active = tab === t.id;
              const showAlert = t.badge === 'alert' && pendingCount > 0;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded px-3 py-1.5 text-[12px] font-medium transition-colors',
                    active
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {t.label}
                  {showAlert && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Tab content ─────────────────────────────────────────── */}
        <div>
          {tab === 'overview'         && <Overview />}
          {tab === 'tokens'           && <TokensTab />}
          {tab === 'spins'            && <SpinsTab />}
          {tab === 'gifts'            && <GiftsTab />}
          {tab === 'claims'           && <ClaimsTab />}
          {tab === 'pending-lifetime' && <PendingLifetime callerRole={callerRole} />}
        </div>
      </div>
    </AdminShell>
  );
}
