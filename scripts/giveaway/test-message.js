#!/usr/bin/env node
// One-shot test: post a public test message + send a test DM
// Run from /opt/chessr/app/discord-bot/ on the VPS so it loads the bot .env
// Usage: cd /opt/chessr/app/discord-bot && node /tmp/test-message.js

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, Partials } from 'discord.js';

const TEST_USER_ID = '1075483647286718548';
const ANNOUNCE_CHANNEL_ID = '1464232479442473104';
const TICKET_CHANNEL_ID = '1464217383739723914';
const TEST_PRIZE = 'Test Prize (please ignore — this is a test)';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

client.once('ready', async () => {
  console.log(`[test] Logged in as ${client.user.tag}`);

  try {
    // 1) Public announce in test channel
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
    if (!channel) throw new Error('Announce channel not found');

    const publicMsg =
      `[TEST] 🎁 <@${TEST_USER_ID}> — **${TEST_PRIZE}**\n\n` +
      `Open a ticket in <#${TICKET_CHANNEL_ID}> to claim within **24 hours** or it will be re-drawn.`;

    await channel.send({
      content: publicMsg,
      allowedMentions: { users: [TEST_USER_ID] },
    });
    console.log(`[test] Public message posted to channel ${ANNOUNCE_CHANNEL_ID}`);

    // 2) DM to test user
    const user = await client.users.fetch(TEST_USER_ID);
    const dmEmbed = new EmbedBuilder()
      .setTitle('🎉 Congratulations!')
      .setDescription(
        `You won the Chessr.io giveaway!\n\n` +
        `Your prize: **${TEST_PRIZE}**\n\n` +
        `To claim it, please open a ticket in <#${TICKET_CHANNEL_ID}> within the next **24 hours**. ` +
        `After that, the prize will be re-drawn and given to someone else.\n\n` +
        `Thanks for being part of the community! ♟️`
      )
      .setColor(0x6366f1)
      .setFooter({ text: 'Chessr.io Giveaway' });

    await user.send({ embeds: [dmEmbed] });
    console.log(`[test] DM sent to user ${TEST_USER_ID}`);
  } catch (err) {
    console.error('[test] FAILED:', err);
    process.exitCode = 1;
  } finally {
    await client.destroy();
    process.exit(process.exitCode || 0);
  }
});

client.login(process.env.DISCORD_TOKEN);
