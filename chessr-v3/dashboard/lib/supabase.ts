import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _cookieSyncBound = false;

function writeAccessTokenCookie(token: string | null | undefined) {
  if (typeof document === 'undefined') return;
  if (token) {
    // 1h max — Supabase access tokens are usually 60 min anyway.
    document.cookie = `sb-access-token=${encodeURIComponent(token)}; path=/; max-age=3600; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  } else {
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
  }
}

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Missing Supabase env vars');
  _client = createClient(url, anon);

  // Mirror the Supabase session access_token into a cookie so server-side
  // middleware (e.g. the /queues/board gate) can authenticate without a
  // round-trip to Supabase. Bound once per page load.
  if (!_cookieSyncBound) {
    _cookieSyncBound = true;
    _client.auth.getSession().then(({ data }) => {
      writeAccessTokenCookie(data.session?.access_token ?? null);
    });
    _client.auth.onAuthStateChange((_evt, session) => {
      writeAccessTokenCookie(session?.access_token ?? null);
    });
  }

  return _client;
}

export function getServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service-role env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
