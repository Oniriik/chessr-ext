'use client';

import { useEffect, useState } from 'react';
import { authQS } from './giveaway-shared';

export interface DiscordProfile {
  discord_id: string;
  username: string | null;
  avatar: string | null;
}

// Module-level cache shared by every caller of the hook within the
// browser tab. Discord usernames are stable enough that we never
// invalidate this in-session — the cost of a stale display name is
// near-zero compared to spamming the resolve endpoint every render.
const profileCache = new Map<string, DiscordProfile>();

/** Resolve a list of discord_ids to {username, avatar}. Returns a Map
 *  keyed by discord_id with all requested IDs always present — the
 *  username/avatar fields are null when the user hasn't linked their
 *  Discord on chessr.io yet, so callers should fall back to rendering
 *  the raw ID in that case. */
export function useResolvedDiscordUsers(ids: string[]): Map<string, DiscordProfile> {
  const [resolved, setResolved] = useState<Map<string, DiscordProfile>>(() => new Map());

  // Stringify the ids to a stable key so the effect doesn't refire on
  // every parent render (a new array reference would otherwise retrigger).
  const key = ids.join(',');

  useEffect(() => {
    if (ids.length === 0) {
      setResolved(new Map());
      return;
    }

    // Hydrate from cache immediately so the panel doesn't flash.
    const next = new Map<string, DiscordProfile>();
    const missing: string[] = [];
    for (const id of ids) {
      const cached = profileCache.get(id);
      if (cached) next.set(id, cached);
      else missing.push(id);
    }
    setResolved(next);

    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        const t = await authQS();
        // Chunk to 200 (server-side cap). Larger giveaways could
        // exceed this; loop covers it.
        const merged = new Map(next);
        for (let i = 0; i < missing.length; i += 200) {
          const slice = missing.slice(i, i + 200);
          const res = await fetch(
            `/api/admin/discord-users/resolve?token=${t}&ids=${slice.join(',')}`,
          );
          const json = (await res.json()) as { users?: DiscordProfile[] };
          for (const u of (json.users ?? [])) {
            const profile: DiscordProfile = {
              discord_id: u.discord_id,
              username: u.username ?? null,
              avatar: u.avatar ?? null,
            };
            profileCache.set(u.discord_id, profile);
            merged.set(u.discord_id, profile);
          }
        }
        if (!cancelled) setResolved(merged);
      } catch {
        // Silent — the panel still renders raw IDs if resolution fails.
      }
    })();

    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return resolved;
}
