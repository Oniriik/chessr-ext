/**
 * Unverified-newcomer welcome flow (#unverified-chat).
 *
 * Two surfaces, one goal — get the member to link their extension so
 * the OAuth callback can grant the free trial and planSync can hand
 * out the roles that unlock the rest of the server:
 *
 *   1) Panel — single pinned embed in DISCORD_UNVERIFIED_CHANNEL_ID
 *      with a "Link my extension" button. Posted via /unverified-setup
 *      once (same admin flow as /ticket-setup).
 *
 *   2) Join greeting — on guildMemberAdd, members whose discord_id is
 *      NOT in user_settings get a mention + the same button. Members
 *      already linked joined through the OAuth callback's guilds.join
 *      and are skipped. Greetings are kept (no auto-delete).
 *
 * The button replies EPHEMERAL (only the clicker sees it) with two
 * link buttons. The chess.com URL carries ?chessr_link_start=1 — the
 * extension content script detects it and kicks off the normal OAuth
 * link flow, so the server side needs nothing new. /play/computer is
 * used (not the homepage) because chess.com redirects logged-in users
 * off the root URL and can drop the query string on the way.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  type GuildMember,
  type Interaction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { BotCommand } from '../lib/commands.js';
import { resolveRoleByDiscordId } from '../lib/roleCheck.js';
import { supabase } from '../lib/supabase.js';

const COLOR_PANEL = 0x3b82f6;

const ID_LINK = 'uv:link';

const LINK_URL     = 'https://www.chess.com/play/computer?chessr_link_start=1';
const DOWNLOAD_URL = 'https://chessr.io';

/** True when the Discord account is already linked to a Chessr user.
 *  Fails open (false) on DB errors — worst case a linked user sees the
 *  link instructions again, which is harmless. */
async function isLinked(discordId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_settings')
    .select('user_id')
    .eq('discord_id', discordId)
    .maybeSingle();
  return !!data;
}

// ─── Panel & greeting content ────────────────────────────────────────────

function panelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_PANEL)
    .setTitle('🔓 Unlock the full server')
    .setDescription(
      'You\'re seeing a limited view because your **Chessr extension isn\'t linked** to Discord yet.\n\n' +
      'Linking takes ~30 seconds and unlocks:\n' +
      '• 🎁 Your **3-day free trial** of Chessr Premium\n' +
      '• 💬 Access to **all the community channels**\n' +
      '• 🏆 Your ELO + plan roles\n\n' +
      'Click the button below to get started.',
    );
}

/** Embed attached to each join greeting. The mention lives in the
 *  message `content` (mentions inside embeds don't ping). */
function greetingEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_PANEL)
    .setTitle('🔓 Unlock the full server')
    .setDescription(
      'You\'re in **unverified chat** for now — link your Chessr extension to unlock:\n\n' +
      '🎁 Your **3-day free trial** of Premium\n' +
      '💬 **All** the community channels\n' +
      '🏆 Your ELO & plan roles\n\n' +
      'It takes ~30 seconds — click the button below to get started.',
    );
}

function linkButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID_LINK)
      .setLabel('Link my extension')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Primary),
  );
}

/** Ephemeral response rows — plain URL buttons, no further interaction. */
function ephemeralLinkRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Get the extension')
      .setEmoji('⬇️')
      .setStyle(ButtonStyle.Link)
      .setURL(DOWNLOAD_URL),
    new ButtonBuilder()
      .setLabel('Open chess.com & link')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Link)
      .setURL(LINK_URL),
  );
}

// ─── Button click → ephemeral instructions ───────────────────────────────

async function handleLinkClick(interaction: ButtonInteraction): Promise<void> {
  if (await isLinked(interaction.user.id)) {
    await interaction.reply({
      content:
        '✅ Your Discord is already linked to a Chessr account. Roles sync ' +
        'automatically — if the channels haven\'t appeared yet, give it a minute.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content:
      '**Here\'s how to unlock everything:**\n' +
      '1. Install the Chessr extension (first button) if you haven\'t yet\n' +
      '2. Log in to Chessr\n' +
      '3. Click **Open chess.com & link** below — the extension takes over and ' +
      'walks you through the Discord link\n\n' +
      'That\'s it: free trial + all channels unlock on their own. 🎉',
    components: [ephemeralLinkRow()],
    ephemeral: true,
  });
}

// ─── Join greeting ───────────────────────────────────────────────────────

async function greetMember(client: Client, member: GuildMember): Promise<void> {
  const channelId = config.discord.unverifiedChannelId;
  if (!channelId) return;
  if (member.user.bot) return;

  // Linked users joined via the OAuth callback's guilds.join — planSync
  // gives them roles momentarily, no need to greet them here.
  if (await isLinked(member.id)) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !('send' in channel)) {
    log.warn(`[unverified] channel ${channelId} not found or not text-based`);
    return;
  }

  await (channel as TextChannel).send({
    content: `👋 Hey <@${member.id}>, welcome to **Chessr.io**!`,
    embeds: [greetingEmbed()],
    components: [linkButtonRow()],
  });
}

// ─── Slash command: /unverified-setup ────────────────────────────────────

export const unverifiedSetupCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('unverified-setup')
    .setDescription('Post the "link your extension" panel in this channel (admin only)')
    // Discord-side gate; the server-side super_admin check below is
    // the authoritative one (same pattern as /ticket-setup).
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString()),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.channel || !('send' in interaction.channel)) {
      await interaction.reply({ content: 'This command must be used in a guild text channel.', ephemeral: true });
      return;
    }
    const role = await resolveRoleByDiscordId(interaction.user.id);
    if (role !== 'super_admin') {
      await interaction.reply({
        content: '❌ super_admin required (link your Chessr account first if you are one).',
        ephemeral: true,
      });
      return;
    }
    const msg = await (interaction.channel as TextChannel).send({
      embeds: [panelEmbed()],
      components: [linkButtonRow()],
    });
    // Pin so the panel survives the greetings piling up below it. Pin
    // failure (Manage Messages missing) shouldn't fail the setup.
    await msg.pin().catch(() => {});
    await interaction.reply({ content: '✅ Unverified panel posted & pinned.', ephemeral: true });
  },
};

// ─── Registration ────────────────────────────────────────────────────────

export function registerWelcomeUnverified(client: Client): void {
  if (!config.discord.unverifiedChannelId) {
    log.info('[unverified] DISCORD_UNVERIFIED_CHANNEL_ID not set — welcome flow disabled');
  }

  client.on('guildMemberAdd', async (member) => {
    try { await greetMember(client, member); }
    catch (err) { log.error('[unverified] greet handler threw:', err); }
  });

  client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== ID_LINK) return;
    try {
      await handleLinkClick(interaction);
    } catch (err) {
      log.error('[unverified] link button handler threw:', err);
      const reply = { content: 'Something went wrong.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  });
}
