/**
 * Resolve a Discord user's chessr role via user_settings. Used to gate
 * privileged bot commands (ticket-setup, future admin tools) on the
 * server-side role rather than just Discord perms.
 *
 * Falls back to 'user' if Discord isn't linked or anything throws —
 * never let a flaky lookup unlock an admin path.
 */

import { supabase } from './supabase.js';

export type UserRole = 'user' | 'admin' | 'super_admin';

export async function resolveRoleByDiscordId(discordId: string): Promise<UserRole> {
  try {
    const { data } = await supabase
      .from('user_settings')
      .select('role')
      .eq('discord_id', discordId)
      .maybeSingle();
    const role = data?.role as UserRole | undefined;
    if (role === 'admin' || role === 'super_admin') return role;
    return 'user';
  } catch {
    return 'user';
  }
}
