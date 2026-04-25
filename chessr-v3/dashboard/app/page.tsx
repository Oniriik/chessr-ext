'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      router.replace(data.session ? '/live' : '/login');
    })();
  }, [router]);

  return (
    <div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div>
  );
}
