#!/usr/bin/env node
// Giveaway draw — weighted random without replacement
// Run from /opt/chessr/app/chessr-next/discord-bot/ so dotenv loads its .env
//   Dry-run (default):  node /tmp/draw.js
//   Send for real:      node /tmp/draw.js --send

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, Partials } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// ---------- Configuration ----------
const ANNOUNCE_CHANNEL_ID = '1464232479442473104';
const TICKET_CHANNEL_ID = '1464217383739723914';
const EXCLUDED_IDS = new Set([
  '1246837630344368179',
  '1037886658462371860',
  '1473784842092023882',
  '1075483647286718548',
]);
// Prizes in order — winner #1 gets PRIZES[0], etc.
const PRIZES = [
  'Lifetime',
  'Monthly Premium',
  'Monthly Premium',
];

// Manual overrides: prize index -> Discord ID. Skips random draw for that slot.
const FIXED_WINNERS = {
  0: '1262748002896842832', // Lifetime → ryan2026_1
  1: '1451640627031965717', // Monthly Premium → fierzcopistachio
  2: '1001396455858262077', // Monthly Premium → tony_stxrk
};

const SEND = process.argv.includes('--send');

// ---------- Helpers ----------
function secureRandomInt(maxExclusive) {
  // Returns 0..maxExclusive-1 with crypto-grade randomness, no modulo bias
  if (maxExclusive <= 0) throw new Error('maxExclusive must be > 0');
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  let r;
  do {
    r = crypto.randomBytes(4).readUInt32BE(0);
  } while (r >= limit);
  return r % maxExclusive;
}

function weightedDrawWithoutReplacement(entrants, count) {
  // entrants: [{ id, username, tickets }]
  const pool = entrants.map((e) => ({ ...e }));
  const winners = [];
  for (let i = 0; i < count; i++) {
    const total = pool.reduce((s, e) => s + e.tickets, 0);
    if (total <= 0) break;
    let pick = secureRandomInt(total);
    let chosenIdx = -1;
    for (let j = 0; j < pool.length; j++) {
      pick -= pool[j].tickets;
      if (pick < 0) {
        chosenIdx = j;
        break;
      }
    }
    if (chosenIdx === -1) chosenIdx = pool.length - 1;
    winners.push(pool[chosenIdx]);
    pool.splice(chosenIdx, 1);
  }
  return winners;
}

// ---------- Main ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

client.once('ready', async () => {
  console.log(`[draw] Logged in as ${client.user.tag}`);
  console.log(`[draw] Mode: ${SEND ? 'SEND (REAL)' : 'DRY RUN'}`);

  try {
    // 1) Active giveaway period
    const { data: period, error: pErr } = await supabase
      .from('giveaway_periods')
      .select('*')
      .eq('active', true)
      .single();
    if (pErr || !period) throw new Error(`No active giveaway period: ${pErr?.message}`);
    console.log(`[draw] Active period: ${period.name} (${period.starts_at} → ${period.ends_at})`);
    console.log(`[draw] Prizes (DB): ${period.prizes || '(none)'}`);

    // 2) Fetch all guild members
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    await guild.members.fetch();
    const members = guild.members.cache;
    console.log(`[draw] Fetched ${members.size} guild members total`);

    // 3) Build entrants: 1 ticket per non-bot, non-excluded member
    const entrants = new Map(); // id -> { id, username, tickets }
    for (const [id, m] of members) {
      if (m.user.bot) continue;
      if (EXCLUDED_IDS.has(id)) continue;
      entrants.set(id, { id, username: m.user.username, tickets: 1 });
    }
    const baseCount = entrants.size;
    console.log(`[draw] Eligible base entrants (after excluding bots + team): ${baseCount}`);

    // 4) Add invite bonuses
    const { data: invites, error: iErr } = await supabase
      .from('invite_events')
      .select('inviter_discord_id, inviter_username')
      .eq('still_in_guild', true)
      .gte('created_at', period.starts_at)
      .lte('created_at', period.ends_at);
    if (iErr) throw new Error(`Invite query failed: ${iErr.message}`);
    console.log(`[draw] Valid invite events in period: ${invites.length}`);

    let bonusApplied = 0;
    let bonusSkippedExcluded = 0;
    let bonusSkippedNotInGuild = 0;
    for (const inv of invites) {
      if (EXCLUDED_IDS.has(inv.inviter_discord_id)) {
        bonusSkippedExcluded++;
        continue;
      }
      const e = entrants.get(inv.inviter_discord_id);
      if (!e) {
        // Inviter has left the guild or is a bot — skip
        bonusSkippedNotInGuild++;
        continue;
      }
      e.tickets++;
      bonusApplied++;
    }
    console.log(
      `[draw] Bonus tickets applied: ${bonusApplied} | skipped (excluded): ${bonusSkippedExcluded} | skipped (inviter not in entrants): ${bonusSkippedNotInGuild}`
    );

    // 5) Build pool & draw
    const pool = Array.from(entrants.values());
    const totalTickets = pool.reduce((s, e) => s + e.tickets, 0);
    console.log(`[draw] Final pool: ${pool.length} entrants, ${totalTickets} total tickets`);

    if (PRIZES.length > pool.length) throw new Error(`Not enough entrants (${pool.length}) for ${PRIZES.length} prizes`);

    // Apply fixed winners first, then draw random for remaining slots
    const winners = new Array(PRIZES.length);
    const remainingPool = pool.filter((e) => !Object.values(FIXED_WINNERS).includes(e.id));
    const randomSlots = [];
    for (let i = 0; i < PRIZES.length; i++) {
      const fixedId = FIXED_WINNERS[i];
      if (fixedId) {
        const member = pool.find((e) => e.id === fixedId);
        if (!member) {
          // Not in pool (excluded, bot, left guild, or never joined) — fall back to fetch
          try {
            const u = await client.users.fetch(fixedId);
            winners[i] = { id: fixedId, username: u.username, tickets: 0, _fixed: true, _notInPool: true };
          } catch {
            winners[i] = { id: fixedId, username: '(unknown)', tickets: 0, _fixed: true, _notInPool: true };
          }
        } else {
          winners[i] = { ...member, _fixed: true };
        }
      } else {
        randomSlots.push(i);
      }
    }
    const drawn = weightedDrawWithoutReplacement(remainingPool, randomSlots.length);
    randomSlots.forEach((slotIdx, k) => {
      winners[slotIdx] = drawn[k];
    });

    console.log('\n========== WINNERS ==========');
    winners.forEach((w, i) => {
      const tag = w._fixed ? ' [FIXED]' : '';
      const notInPool = w._notInPool ? ' (NOT IN POOL — fixed by ID)' : '';
      console.log(`#${i + 1}  ${PRIZES[i].padEnd(20)}  ${(w.username || '(unknown)').padEnd(30)}  id=${w.id}  (${w.tickets} tickets)${tag}${notInPool}`);
    });
    console.log('=============================\n');

    // Build messages
    const winnerLines = winners.map((w, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '🏅';
      return `${medal} <@${w.id}> — **${PRIZES[i]}**`;
    }).join('\n');

    const publicMsg =
      `🎁 **Giveaway Results!**\n\n` +
      `Congratulations to our winners:\n${winnerLines}\n\n` +
      `Open a ticket in <#${TICKET_CHANNEL_ID}> to claim your prize.\n` +
      `⏰ You have **24 hours** — after that, the prize will be re-drawn.`;

    console.log('--- PUBLIC MESSAGE ---');
    console.log(publicMsg);
    console.log('----------------------\n');

    if (!SEND) {
      console.log('[draw] DRY RUN complete. Re-run with --send to actually post.');
      return;
    }

    // 6) SEND
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
    await channel.send({
      content: publicMsg,
      allowedMentions: { users: winners.map((w) => w.id) },
    });
    console.log(`[draw] Public message posted in ${ANNOUNCE_CHANNEL_ID}`);

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      const prize = PRIZES[i];
      try {
        const user = await client.users.fetch(w.id);
        const dmEmbed = new EmbedBuilder()
          .setTitle('🎉 Congratulations!')
          .setDescription(
            `You won the Chessr.io giveaway!\n\n` +
            `Your prize: **${prize}**\n\n` +
            `To claim it, please open a ticket in <#${TICKET_CHANNEL_ID}> within the next **24 hours**. ` +
            `After that, the prize will be re-drawn and given to someone else.\n\n` +
            `Thanks for being part of the community! ♟️`
          )
          .setColor(0x6366f1)
          .setFooter({ text: 'Chessr.io Giveaway' });
        await user.send({ embeds: [dmEmbed] });
        console.log(`[draw] DM sent to ${w.username} (${w.id}) — ${prize}`);
      } catch (e) {
        console.error(`[draw] DM FAILED to ${w.username} (${w.id}):`, e.message);
      }
    }
  } catch (err) {
    console.error('[draw] ERROR:', err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
    process.exit(process.exitCode || 0);
  }
});

client.login(process.env.DISCORD_TOKEN);
