#!/usr/bin/env node
// Giveaway redraw — fixed winners (no random draw).
// The original Monthly Premium winners didn't claim, so we hand-pick replacements.
//
// Run from /opt/chessr/app/chessr-next/discord-bot/ so dotenv loads its .env
//   Dry-run (default):  node /path/to/redraw.js
//   Send for real:      node /path/to/redraw.js --send

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, Partials } from 'discord.js';

// ---------- Configuration ----------
const ANNOUNCE_CHANNEL_ID = '1464232479442473104';
const TICKET_CHANNEL_ID = '1464217383739723914';

// Fixed winners by Discord username — resolved against the guild at runtime.
// Order = prize order (winners[0] gets PRIZES[0], etc.)
const FIXED_WINNER_USERNAMES = [
  'ex_mozarella',
  'ryanisresting',
];

const PRIZES = [
  'Monthly Premium',
  'Monthly Premium',
];

const SEND = process.argv.includes('--send');

// ---------- Helpers ----------
function secureRandomInt(maxExclusive) {
  if (maxExclusive <= 0) throw new Error('maxExclusive must be > 0');
  const limit = Math.floor(0xffffffff / maxExclusive) * maxExclusive;
  let r;
  do {
    r = crypto.randomBytes(4).readUInt32BE(0);
  } while (r >= limit);
  return r % maxExclusive;
}

function weightedDrawWithoutReplacement(entrants, count) {
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
  console.log(`[redraw] Logged in as ${client.user.tag}`);
  console.log(`[redraw] Mode: ${SEND ? 'SEND (REAL)' : 'DRY RUN'}`);

  try {
    // 1) Find target period (the OLD one, not the active restart)
    let period;
    if (PERIOD_NAME) {
      const { data, error } = await supabase
        .from('giveaway_periods')
        .select('*')
        .eq('name', PERIOD_NAME)
        .single();
      if (error || !data) throw new Error(`Period "${PERIOD_NAME}" not found: ${error?.message}`);
      period = data;
    } else {
      // --previous: latest period that is NOT active (i.e. the one we just closed)
      const { data, error } = await supabase
        .from('giveaway_periods')
        .select('*')
        .eq('active', false)
        .order('ends_at', { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) throw new Error(`No previous (closed) period found: ${error?.message}`);
      period = data[0];
    }
    console.log(`[redraw] Using period: ${period.name} (${period.starts_at} → ${period.ends_at}) active=${period.active}`);

    // 2) Fetch all guild members
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    await guild.members.fetch();
    const members = guild.members.cache;
    console.log(`[redraw] Fetched ${members.size} guild members total`);

    // 3) Build entrants: 1 ticket per non-bot, non-excluded, non-previous-winner member
    const entrants = new Map();
    let skippedPrevWinner = 0;
    for (const [id, m] of members) {
      if (m.user.bot) continue;
      if (EXCLUDED_IDS.has(id)) continue;
      if (PREVIOUS_WINNERS.has(id)) {
        skippedPrevWinner++;
        continue;
      }
      entrants.set(id, { id, username: m.user.username, tickets: 1 });
    }
    console.log(`[redraw] Eligible base entrants: ${entrants.size} (skipped ${skippedPrevWinner} previous winners still in guild)`);

    // 4) Add invite bonuses from the OLD period
    const { data: invites, error: iErr } = await supabase
      .from('invite_events')
      .select('inviter_discord_id, inviter_username')
      .eq('still_in_guild', true)
      .gte('created_at', period.starts_at)
      .lte('created_at', period.ends_at);
    if (iErr) throw new Error(`Invite query failed: ${iErr.message}`);
    console.log(`[redraw] Valid invite events in period: ${invites.length}`);

    let bonusApplied = 0;
    let bonusSkippedExcluded = 0;
    let bonusSkippedPrevWinner = 0;
    let bonusSkippedNotInGuild = 0;
    for (const inv of invites) {
      if (EXCLUDED_IDS.has(inv.inviter_discord_id)) { bonusSkippedExcluded++; continue; }
      if (PREVIOUS_WINNERS.has(inv.inviter_discord_id)) { bonusSkippedPrevWinner++; continue; }
      const e = entrants.get(inv.inviter_discord_id);
      if (!e) { bonusSkippedNotInGuild++; continue; }
      e.tickets++;
      bonusApplied++;
    }
    console.log(
      `[redraw] Bonus tickets applied: ${bonusApplied} | skipped staff: ${bonusSkippedExcluded} | skipped prev winner: ${bonusSkippedPrevWinner} | skipped not in entrants: ${bonusSkippedNotInGuild}`
    );

    // 5) Build pool & draw
    const pool = Array.from(entrants.values());
    const totalTickets = pool.reduce((s, e) => s + e.tickets, 0);
    console.log(`[redraw] Final pool: ${pool.length} entrants, ${totalTickets} total tickets`);

    if (PRIZES.length > pool.length) throw new Error(`Not enough entrants (${pool.length}) for ${PRIZES.length} prizes`);

    const winners = weightedDrawWithoutReplacement(pool, PRIZES.length);

    console.log('\n========== REDRAW WINNERS ==========');
    winners.forEach((w, i) => {
      console.log(`#${i + 1}  ${PRIZES[i].padEnd(20)}  ${(w.username || '(unknown)').padEnd(30)}  id=${w.id}  (${w.tickets} tickets)`);
    });
    console.log('====================================\n');

    // Build messages — medals start at 🥈 since this replaces the 2nd & 3rd place
    const winnerLines = winners.map((w, i) => {
      const medal = i === 0 ? '🥈' : '🥉';
      return `${medal} <@${w.id}> — **${PRIZES[i]}**`;
    }).join('\n');

    const publicMsg =
      `🔄 **Giveaway Redraw!**\n\n` +
      `The previous Monthly Premium winners didn't claim their prize in time. ` +
      `We just redrew — congrats to the new winners:\n\n` +
      `${winnerLines}\n\n` +
      `Open a ticket in <#${TICKET_CHANNEL_ID}> to claim your prize.\n` +
      `⏰ You have **24 hours** — after that, the prize will be re-drawn again.`;

    console.log('--- PUBLIC MESSAGE ---');
    console.log(publicMsg);
    console.log('----------------------\n');

    if (!SEND) {
      console.log('[redraw] DRY RUN complete. Re-run with --send to actually post.');
      return;
    }

    // 6) SEND
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
    await channel.send({
      content: publicMsg,
      allowedMentions: { users: winners.map((w) => w.id) },
    });
    console.log(`[redraw] Public message posted in ${ANNOUNCE_CHANNEL_ID}`);

    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      const prize = PRIZES[i];
      try {
        const user = await client.users.fetch(w.id);
        const dmEmbed = new EmbedBuilder()
          .setTitle('🎉 Congratulations!')
          .setDescription(
            `You won the Chessr.io giveaway redraw!\n\n` +
            `Your prize: **${prize}**\n\n` +
            `To claim it, please open a ticket in <#${TICKET_CHANNEL_ID}> within the next **24 hours**. ` +
            `After that, the prize will be re-drawn and given to someone else.\n\n` +
            `Thanks for being part of the community! ♟️`
          )
          .setColor(0x6366f1)
          .setFooter({ text: 'Chessr.io Giveaway' });
        await user.send({ embeds: [dmEmbed] });
        console.log(`[redraw] DM sent to ${w.username} (${w.id}) — ${prize}`);
      } catch (e) {
        console.error(`[redraw] DM FAILED to ${w.username} (${w.id}):`, e.message);
      }
    }
  } catch (err) {
    console.error('[redraw] ERROR:', err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
    process.exit(process.exitCode || 0);
  }
});

client.login(process.env.DISCORD_TOKEN);
