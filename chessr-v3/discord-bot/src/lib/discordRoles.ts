/**
 * Plan → Discord role sync.
 *
 * Adds the role for the user's current plan and removes any of the OTHER
 * plan roles. We touch each role individually (PUT/DELETE per role) so
 * we don't blow away unrelated roles a member might have — PATCHing the
 * full role list is destructive and requires us to preserve their roles
 * for us, which we'd have to fetch first anyway. This is simpler.
 *
 * Discord API quirks worth remembering:
 *   - PUT /guilds/{g}/members/{u}/roles/{r}        → 204 on success/no-op
 *   - DELETE /guilds/{g}/members/{u}/roles/{r}     → 204 on success/no-op
 *   - 404 = member not in guild (fine, just skip)
 *   - 403 = bot lacks Manage Roles or its highest role is below the target
 *
 * The bot needs `Manage Roles` in the guild AND its own highest role must
 * be ABOVE every plan role for the changes to land. If the bot returns
 * 403 here, raise its role in the server settings.
 */

import { config } from '../config.js';
import { log } from './logger.js';

const DISCORD_API = 'https://discord.com/api/v10';

/** Role IDs that are managed by the plan-sync logic. The set is the
 *  union of all configured plan roles — anything not in here is left
 *  untouched on a member. */
function managedRoleIds(): string[] {
  return Object.values(config.planRoles).filter((v): v is string => !!v);
}

/** Resolve the role id for a given plan, or null when:
 *   - plan is null  → caller wants the user fully de-tiered (unlink
 *     / delete path); we just remove every managed role.
 *   - plan is set but no role id is configured for it → tier exists
 *     but isn't represented on Discord; same outcome.
 *  Plan strings ('free' | 'freetrial' | 'premium' | 'beta' | 'lifetime')
 *  match what the dashboard / serveur emit verbatim. */
function roleIdFor(plan: string | null | undefined): string | null {
  if (!plan) return null;
  return config.planRoles[plan] ?? null;
}

async function discordFetch(method: 'PUT' | 'DELETE', path: string): Promise<number> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: { Authorization: `Bot ${config.discord.token}` },
  });
  return res.status;
}

/** Apply the plan → role mapping for one Discord member. Adds the new
 *  role (if any) and removes every other plan role. Idempotent. */
export async function syncPlanRole(discordUserId: string, plan: string | null): Promise<void> {
  if (!config.discord.guildId) {
    log.debug('[roles] no guild configured, skipping sync');
    return;
  }
  if (!discordUserId) {
    log.warn('[roles] sync called without discordUserId');
    return;
  }

  const guildId = config.discord.guildId;
  const targetRoleId = roleIdFor(plan);
  const allManagedRoleIds = managedRoleIds();

  // Remove all OTHER plan roles. Doing the removes first means we never
  // briefly carry two plan roles at once if the user upgrades.
  for (const roleId of allManagedRoleIds) {
    if (roleId === targetRoleId) continue;
    const status = await discordFetch(
      'DELETE',
      `/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`,
    );
    if (status !== 204 && status !== 404) {
      log.warn(`[roles] failed to remove ${roleId} from ${discordUserId}: HTTP ${status}`);
    }
  }

  if (targetRoleId) {
    const status = await discordFetch(
      'PUT',
      `/guilds/${guildId}/members/${discordUserId}/roles/${targetRoleId}`,
    );
    if (status !== 204 && status !== 404) {
      log.warn(`[roles] failed to add ${targetRoleId} to ${discordUserId}: HTTP ${status}`);
    } else if (status === 204) {
      log.info(`[roles] ${discordUserId} → ${plan} (${targetRoleId})`);
    }
  } else if (allManagedRoleIds.length > 0) {
    log.info(`[roles] ${discordUserId} → free (all plan roles removed)`);
  }
}
