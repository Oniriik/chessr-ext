/**
 * Invite tracker. Discord doesn't tell us "user X joined via invite Y";
 * instead we keep a cache of invite-code → uses, and on guildMemberAdd
 * we re-fetch and diff to see which code's count went up by 1.
 *
 *  - cache populated at boot for every guild the bot is in
 *  - inviteCreate / inviteDelete keep the cache fresh between joins
 *  - vanity URL joins fall through to inviter=null on the serveur side
 *  - the bot owns NO storage; serveur persists the join to invite_uses
 *    and (if relevant) grants the inviter a giveaway ticket
 */

import {
  type Client,
  type Guild,
  type GuildMember,
  type Invite,
  EmbedBuilder,
} from 'discord.js';
import { log } from '../lib/logger.js';
import { logInviteUse } from '../lib/giveawayApi.js';

interface CachedInvite { code: string; uses: number; inviterId: string | null }

const cache = new Map<string, Map<string, CachedInvite>>(); // guildId → code → row

async function snapshotGuild(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map<string, CachedInvite>();
    invites.forEach((inv: Invite) => {
      map.set(inv.code, {
        code: inv.code,
        uses: inv.uses ?? 0,
        inviterId: inv.inviter?.id ?? null,
      });
    });
    cache.set(guild.id, map);
    log.info(`[invites] cached ${map.size} invites for guild ${guild.id}`);
  } catch (err) {
    log.warn(`[invites] cache fetch failed for guild ${guild.id}:`, err);
  }
}

async function diffAndAttribute(member: GuildMember): Promise<void> {
  const guild = member.guild;
  const prev = cache.get(guild.id) ?? new Map<string, CachedInvite>();

  let next: Map<string, CachedInvite>;
  try {
    const fresh = await guild.invites.fetch();
    next = new Map();
    fresh.forEach((inv) => {
      next.set(inv.code, { code: inv.code, uses: inv.uses ?? 0, inviterId: inv.inviter?.id ?? null });
    });
  } catch (err) {
    log.warn(`[invites] failed to fetch invites for ${guild.id}:`, err);
    next = prev;
  }

  // Find the invite whose use count went up by 1 since the last snapshot.
  // If multiple match (unlikely but possible if joins are batched) we
  // pick the first — we can't disambiguate without the audit log.
  let usedCode: string | null = null;
  let inviterId: string | null = null;
  for (const [code, row] of next) {
    const before = prev.get(code)?.uses ?? 0;
    if (row.uses > before) {
      usedCode = code;
      inviterId = row.inviterId;
      break;
    }
  }

  // Replace the cache regardless of attribution — keeps the next diff
  // accurate even when this one was inconclusive.
  cache.set(guild.id, next);

  // Persist + maybe-grant. Vanity URL → inviter=null is a valid log row;
  // the serveur just won't grant any tickets.
  let result;
  try {
    result = await logInviteUse({
      guildId: guild.id,
      inviteeDiscordId: member.id,
      inviterDiscordId: inviterId,
      inviteCode: usedCode,
    });
  } catch (err) {
    log.error('[invites] logInviteUse failed:', err);
    return;
  }

  log.info(
    `[invites] ${member.user.tag} joined via ${usedCode ?? 'vanity/unknown'} ` +
    `(inviter=${inviterId ?? 'null'}, tickets=${result.ticketsGranted ?? 0})`,
  );

  // DM the inviter when they got at least one ticket — confirms the
  // invite landed and motivates more.
  if (inviterId && (result.ticketsGranted ?? 0) > 0) {
    try {
      const inviter = await member.client.users.fetch(inviterId);
      await inviter.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x10b981)
            .setTitle('🎟️ +1 giveaway ticket')
            .setDescription(
              `Thanks for inviting <@${member.id}>! ` +
              `You earned **${result.ticketsGranted}** ticket${(result.ticketsGranted ?? 0) === 1 ? '' : 's'} ` +
              'across active giveaways.\n\nUse `/giveaway` to see your standing.',
            ),
        ],
      });
    } catch (err) {
      // DMs disabled is the common case — log and move on.
      log.warn(`[invites] DM to inviter ${inviterId} failed:`, err);
    }
  }
}

export function registerInviteTracker(client: Client): void {
  client.on('clientReady', async () => {
    // Initial snapshot of every guild the bot is in.
    for (const [, guild] of client.guilds.cache) {
      await snapshotGuild(guild);
    }
  });

  client.on('inviteCreate', (invite) => {
    if (!invite.guild) return;
    const map = cache.get(invite.guild.id) ?? new Map<string, CachedInvite>();
    map.set(invite.code, { code: invite.code, uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
    cache.set(invite.guild.id, map);
  });

  client.on('inviteDelete', (invite) => {
    if (!invite.guild) return;
    const map = cache.get(invite.guild.id);
    map?.delete(invite.code);
  });

  client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return;
    try { await diffAndAttribute(member); }
    catch (err) { log.error('[invites] guildMemberAdd handler threw:', err); }
  });
}
