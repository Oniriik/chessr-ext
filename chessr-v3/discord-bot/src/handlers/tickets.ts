/**
 * Support ticket system.
 *
 * Three categories of channel involvement:
 *
 *   1) Panel — single message in DISCORD_TICKET_CHANNEL_ID with an
 *      "Open a ticket" button. Posted via /ticket-setup once.
 *
 *   2) Open category (DISCORD_TICKET_OPEN_CATEGORY_ID) — newly created
 *      ticket channels live here. Channel name: help-####-username.
 *      Welcome message has Close + Info buttons.
 *
 *   3) Closed category (DISCORD_TICKET_CLOSED_CATEGORY_ID) — closed
 *      tickets get renamed to closed-####-username and moved here. The
 *      opener loses ViewChannel. The "closed" message has Reopen +
 *      Delete buttons.
 *
 * The DB tracks state (tickets table); the bot's state is implicit in
 * the channel id / category. On a fresh bot start, channels carry over
 * because the buttons' customIds encode the ticket id.
 *
 * Permissions for Info / Close / Reopen / Delete: bot checks
 * ManageChannels on the caller. We don't need a hardcoded "team role
 * id" — admins typically have ManageChannels and configuring the
 * categories via per-category overrides handles team visibility.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  ChannelType,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  type Interaction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { BotCommand } from '../lib/commands.js';
import { onEvent } from '../lib/events.js';
import { resolveRoleByDiscordId } from '../lib/roleCheck.js';
import {
  closeTicket,
  deleteTicket,
  getByChannel,
  getOpenForOpener,
  getTicketInfo,
  openTicket,
  reopenTicket,
} from '../lib/ticketsApi.js';

const COLOR_PANEL    = 0x3b82f6;
const COLOR_OPEN     = 0x10b981;
const COLOR_CLOSED   = 0x94a3b8;
const COLOR_WARN     = 0xf59e0b;
const COLOR_INFO     = 0x3b82f6;
const COLOR_ERR      = 0xef4444;

const ID = {
  open:          'tk:open',
  close:         (tid: number) => `tk:close:${tid}`,
  closeConfirm:  (tid: number) => `tk:close-confirm:${tid}`,
  closeCancel:   'tk:close-cancel',
  reopen:        (tid: number) => `tk:reopen:${tid}`,
  delete:        (tid: number) => `tk:delete:${tid}`,
  deleteConfirm: (tid: number) => `tk:delete-confirm:${tid}`,
  info:          (tid: number) => `tk:info:${tid}`,
};

const PREFIX = 'tk:';

function pad4(n: number): string { return String(n).padStart(4, '0'); }

/** Auto-dismiss an ephemeral interaction reply after `ms` so the
 *  "✅ Ticket created" toast doesn't linger. The interaction token
 *  has a 15-min Discord-side TTL — we ack errors silently. */
function scheduleEphemeralDelete(
  interaction: ButtonInteraction | ChatInputCommandInteraction,
  ms = 30_000,
): void {
  setTimeout(() => {
    interaction.deleteReply().catch(() => {});
  }, ms);
}

// ─── Panel & open flow ───────────────────────────────────────────────────

function panelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLOR_PANEL)
    .setTitle('🎫 Chessr Support')
    .setDescription(
      'Need help with your account, billing, a bug, or to claim a giveaway/wheel prize?\n' +
      'Click below — a private channel will be opened with our team.',
    );
}

function panelRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.open)
      .setLabel('Open a ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  );
}

function openTicketButtons(ticketId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.close(ticketId))
      .setLabel('Close ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(ID.info(ticketId))
      .setLabel('Info')
      .setEmoji('ℹ️')
      .setStyle(ButtonStyle.Primary),
  );
}

function closedTicketButtons(ticketId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.reopen(ticketId))
      .setLabel('Reopen')
      .setEmoji('🔓')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(ID.delete(ticketId))
      .setLabel('Delete')
      .setEmoji('🗑')
      .setStyle(ButtonStyle.Danger),
  );
}

// ─── Slash command: /ticket-setup ────────────────────────────────────────

const ticketSetupCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Post the ticket panel embed in this channel (admin only)')
    // Discord-side gate: only members with Administrator see the
    // command in the picker. Server-side super_admin check below is
    // the authoritative gate.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString()),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.channel || !('send' in interaction.channel)) {
      await interaction.reply({ content: 'This command must be used in a guild text channel.', ephemeral: true });
      return;
    }
    // Server-side gate — Discord perms can be spoofed by re-publishing
    // the command with broader access; the role lookup against
    // user_settings is the source of truth.
    const role = await resolveRoleByDiscordId(interaction.user.id);
    if (role !== 'super_admin') {
      await interaction.reply({
        content: '❌ super_admin required (link your Chessr account first if you are one).',
        ephemeral: true,
      });
      return;
    }
    await (interaction.channel as TextChannel).send({
      embeds: [panelEmbed()],
      components: [panelRow()],
    });
    await interaction.reply({ content: '✅ Ticket panel posted.', ephemeral: true });
  },
};

// ─── Slash command: /new-ticket ──────────────────────────────────────────
// Admin-initiated ticket creation. Same channel layout, perms and
// lifecycle (close → 12h auto-delete, reopen, manual delete, info) as
// a user-clicked Open. Useful for opening a ticket for someone
// proactively (abuse review, lifetime claim hand-holding, …).

const newTicketCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('new-ticket')
    .setDescription('Create a support ticket for a user (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .addUserOption((opt) =>
      opt.setName('member')
        .setDescription('The user to create a ticket for')
        .setRequired(true),
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command must be used in a guild.', ephemeral: true });
      return;
    }
    const role = await resolveRoleByDiscordId(interaction.user.id);
    if (role !== 'super_admin') {
      await interaction.reply({
        content: '❌ super_admin required.',
        ephemeral: true,
      });
      return;
    }

    const member = interaction.options.getUser('member', true);
    if (member.bot) {
      await interaction.reply({ content: 'Cannot open a ticket for a bot.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const openCatId = config.discord.ticketOpenCategoryId;
    if (!openCatId) {
      await interaction.editReply({ content: 'Ticket system not fully configured (DISCORD_TICKET_OPEN_CATEGORY_ID).' });
      return;
    }

    // One open ticket per opener — same constraint as user-initiated.
    const existing = await getOpenForOpener(member.id).catch(() => null);
    if (existing) {
      await interaction.editReply({ content: `<@${member.id}> already has an open ticket: <#${existing.channel_id}>` });
      return;
    }

    const username = member.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'user';
    const guild = interaction.guild;

    let channel: TextChannel;
    try {
      channel = await guild.channels.create({
        name: `help-pending-${username}`,
        type: ChannelType.GuildText,
        parent: openCatId,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: member.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
        ],
      }) as TextChannel;
    } catch (err) {
      log.error('[tickets] /new-ticket channel create failed:', err);
      await interaction.editReply({ content: 'Could not create the channel.' });
      return;
    }

    let row;
    try {
      row = await openTicket({
        openerDiscordId: member.id,
        openerUsername: member.username,
        channelId: channel.id,
      });
    } catch (err) {
      log.error('[tickets] /new-ticket DB insert failed; rolling back channel:', err);
      await channel.delete().catch(() => {});
      await interaction.editReply({ content: 'Could not register the ticket.' });
      return;
    }

    const padded = pad4(row.id);
    await channel.setName(`help-${padded}-${username}`).catch(() => {});
    await channel.setTopic(
      `Ticket #${padded} | Opened by ${member.tag} (${member.id}) | Created by ${interaction.user.tag}`,
    ).catch(() => {});

    await channel.send({
      content: `🎫 **Ticket #${padded}** — opened for <@${member.id}> by <@${interaction.user.id}>`,
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_OPEN)
          .setDescription(
            `Hi <@${member.id}>! Our team has opened this ticket on your behalf.\n` +
            'Please describe your situation here.\n\n' +
            'Use the button below to **close** the ticket once it\'s resolved.',
          ),
      ],
      components: [openTicketButtons(row.id)],
    });

    await interaction.editReply({ content: `✅ Ticket created for <@${member.id}>: <#${channel.id}>` });
    scheduleEphemeralDelete(interaction);
    log.info(`[tickets] ${interaction.user.tag} created ticket #${padded} for ${member.tag} via /new-ticket`);
  },
};

export const ticketCommands: BotCommand[] = [ticketSetupCommand, newTicketCommand];

// ─── Open flow ───────────────────────────────────────────────────────────

async function handleOpenClick(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply({ content: 'Tickets only work in a guild.' });
    return;
  }
  const openCatId = config.discord.ticketOpenCategoryId;
  if (!openCatId) {
    log.warn('[tickets] DISCORD_TICKET_OPEN_CATEGORY_ID not set');
    await interaction.editReply({ content: 'Ticket system not fully configured. Please ping an admin.' });
    return;
  }

  // Reject duplicates — one open ticket at a time per user.
  const existing = await getOpenForOpener(interaction.user.id).catch(() => null);
  if (existing) {
    await interaction.editReply({
      content: `You already have an open ticket: <#${existing.channel_id}>`,
    });
    return;
  }

  const username = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'user';

  // Two-phase: create the channel first (we need its id), then create
  // the DB row pointing at it. If DB insert fails we delete the channel.
  let channel: TextChannel;
  try {
    channel = await guild.channels.create({
      name: `help-pending-${username}`,
      type: ChannelType.GuildText,
      parent: openCatId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        },
      ],
    }) as TextChannel;
  } catch (err) {
    log.error('[tickets] channel create failed:', err);
    await interaction.editReply({ content: 'Could not create the ticket channel. Please ping an admin.' });
    return;
  }

  let row;
  try {
    row = await openTicket({
      openerDiscordId: interaction.user.id,
      openerUsername: interaction.user.username,
      channelId: channel.id,
    });
  } catch (err) {
    log.error('[tickets] DB insert failed; rolling back channel:', err);
    await channel.delete().catch(() => {});
    await interaction.editReply({ content: 'Could not register the ticket. Please ping an admin.' });
    return;
  }

  const padded = pad4(row.id);
  await channel.setName(`help-${padded}-${username}`).catch(() => {});
  await channel.setTopic(`Ticket #${padded} | Opened by ${interaction.user.tag} (${interaction.user.id})`).catch(() => {});

  const supportPing = config.discord.ticketSupportRoleId
    ? ` — <@&${config.discord.ticketSupportRoleId}> will be with you shortly`
    : '';
  await channel.send({
    content: `🎫 **Ticket #${padded}** — opened by <@${interaction.user.id}>${supportPing}`,
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_OPEN)
        .setDescription(
          'Hi! Please describe your issue here and our team will get back to you shortly.\n\n' +
          'Use the button below to **close** the ticket once it\'s resolved.',
        ),
    ],
    components: [openTicketButtons(row.id)],
  });

  await interaction.editReply({ content: `✅ Ticket created: <#${channel.id}>` });
  scheduleEphemeralDelete(interaction);
  log.info(`[tickets] ${interaction.user.tag} opened #${padded} (channel ${channel.id})`);
}

// ─── Close flow (confirm → confirm-close) ────────────────────────────────

async function handleCloseClick(interaction: ButtonInteraction, ticketId: number): Promise<void> {
  if (!await ensureAdmin(interaction)) return;

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLOR_WARN).setDescription('⚠️ Close this ticket?')],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.closeConfirm(ticketId)).setLabel('Confirm close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ID.closeCancel).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

async function handleCloseConfirm(interaction: ButtonInteraction, _ticketId: number): Promise<void> {
  await interaction.deferUpdate().catch(() => {});

  const channel = interaction.channel as TextChannel | null;
  if (!channel) return;

  const ticket = await getByChannel(channel.id).catch(() => null);
  if (!ticket || ticket.status !== 'open') {
    await interaction.followUp({ content: 'Ticket no longer open.', ephemeral: true }).catch(() => {});
    return;
  }

  const padded = pad4(ticket.id);
  const username = (ticket.opener_username ?? 'user').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);

  // DB flip first — if Discord ops fail mid-way we re-attempt next click.
  await closeTicket(ticket.id, interaction.user.id);

  // Send the close message FIRST. setName / setParent rate-limit
  // aggressively (channel updates have their own bucket) and a slow
  // failure cascade can starve channel.send, leaving the channel
  // visibly closed in DB but with no closure message in Discord.
  try {
    // Auto-delete countdown shown as a Discord relative timestamp —
    // renders client-side as "in 12 hours" / "in 5h" / "in 30m".
    const deleteTs = Math.floor((Date.now() + 12 * 60 * 60 * 1000) / 1000);
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_CLOSED)
          .setDescription(
            `🔒 Ticket closed by <@${interaction.user.id}>\n\n` +
            `🗑 This channel will be auto-deleted <t:${deleteTs}:R> (<t:${deleteTs}:F>).\n` +
            'Use the buttons below to **Reopen** or **Delete** now.',
          )
          .setTimestamp(),
      ],
      components: [closedTicketButtons(ticket.id)],
    });
  } catch (err) {
    log.error('[tickets] close message send failed:', err);
  }

  // Now the slow ops. Each is best-effort.
  const closedCatId = config.discord.ticketClosedCategoryId;
  if (closedCatId) {
    await channel.setParent(closedCatId, { lockPermissions: false }).catch((e) => log.warn('[tickets] move-to-closed failed:', e));
  }
  await channel.setName(`closed-${padded}-${username}`).catch((e) => log.warn('[tickets] rename failed:', e));
  await channel.permissionOverwrites.edit(ticket.opener_discord_id, { ViewChannel: false }).catch(() => {});

  log.info(`[tickets] ${interaction.user.tag} closed #${padded}`);
}

async function handleCloseCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: 'Close cancelled.',
    embeds: [],
    components: [],
  });
}

// ─── Reopen flow ─────────────────────────────────────────────────────────

async function handleReopenClick(interaction: ButtonInteraction, _ticketId: number): Promise<void> {
  if (!await ensureAdmin(interaction)) return;
  await interaction.deferUpdate().catch(() => {});

  const channel = interaction.channel as TextChannel | null;
  if (!channel) return;

  const ticket = await getByChannel(channel.id).catch(() => null);
  if (!ticket) {
    await interaction.followUp({ content: 'Ticket not found in DB.', ephemeral: true }).catch(() => {});
    return;
  }
  if (ticket.status === 'open') {
    await interaction.followUp({ content: 'Ticket already open.', ephemeral: true }).catch(() => {});
    return;
  }
  if (ticket.status !== 'closed') {
    await interaction.followUp({ content: `Cannot reopen a ${ticket.status} ticket.`, ephemeral: true }).catch(() => {});
    return;
  }

  // Flip DB first so the auto-delete cron stops considering this row.
  try {
    await reopenTicket(ticket.id);
  } catch (err) {
    log.error('[tickets] reopen API failed:', err);
    await interaction.followUp({ content: 'Reopen failed (server error). Try again.', ephemeral: true }).catch(() => {});
    return;
  }

  const padded = pad4(ticket.id);

  // Post the reopen message FIRST — same rationale as the close fix:
  // setParent / setName / permissionOverwrites.edit can rate-limit and
  // starve channel.send for a noticeable delay, leaving a flipped DB
  // row but no Discord feedback.
  try {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_OPEN)
          .setDescription(`🔓 Ticket reopened by <@${interaction.user.id}>`)
          .setTimestamp(),
      ],
      components: [openTicketButtons(ticket.id)],
    });
  } catch (err) {
    log.error('[tickets] reopen message send failed:', err);
  }

  // Slow ops: parent/category, name, opener perms. All best-effort.
  const openCatId = config.discord.ticketOpenCategoryId;
  if (openCatId && channel.parentId !== openCatId) {
    await channel.setParent(openCatId, { lockPermissions: false }).catch((e) => log.warn('[tickets] move-to-open failed:', e));
  }
  const username = (ticket.opener_username ?? 'user').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20);
  await channel.setName(`help-${padded}-${username}`).catch((e) => log.warn('[tickets] reopen rename failed:', e));
  await channel.permissionOverwrites.edit(ticket.opener_discord_id, {
    ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
  }).catch(() => {});

  log.info(`[tickets] ${interaction.user.tag} reopened #${padded}`);
}

// ─── Delete flow (closed-only; one-step confirm to avoid mistakes) ───────

async function handleDeleteClick(interaction: ButtonInteraction, ticketId: number): Promise<void> {
  if (!await ensureAdmin(interaction)) return;

  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription('⚠️ Delete the ticket channel?')],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.deleteConfirm(ticketId)).setLabel('Confirm delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(ID.closeCancel).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  });
}

async function handleDeleteConfirm(interaction: ButtonInteraction, _ticketId: number): Promise<void> {
  if (!await ensureAdmin(interaction)) return;
  await interaction.deferUpdate().catch(() => {});

  const channel = interaction.channel as TextChannel | null;
  if (!channel) return;

  const ticket = await getByChannel(channel.id).catch(() => null);
  if (!ticket) {
    await interaction.followUp({ content: 'Ticket row missing.', ephemeral: true }).catch(() => {});
    return;
  }

  // Mark deleted in DB FIRST so a failure to delete the Discord channel
  // doesn't leave us with a "deleted" row that shouldn't be — actually
  // wait, we want the opposite: only mark deleted if Discord channel
  // is actually gone. Let's do channel.delete() first, then DB.
  try {
    await channel.delete(`Ticket #${pad4(ticket.id)} deleted by ${interaction.user.tag}`);
  } catch (err) {
    log.error('[tickets] channel delete failed:', err);
    await interaction.followUp({ content: 'Failed to delete the channel.', ephemeral: true }).catch(() => {});
    return;
  }

  await deleteTicket(ticket.id, interaction.user.id).catch((err) => log.warn('[tickets] DB delete update failed:', err));
  log.info(`[tickets] ${interaction.user.tag} deleted ticket #${pad4(ticket.id)}`);
}

// ─── Info flow ───────────────────────────────────────────────────────────

async function handleInfoClick(interaction: ButtonInteraction, _ticketId: number): Promise<void> {
  if (!await ensureAdmin(interaction)) return;
  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.channel as TextChannel | null;
  if (!channel) return;
  const ticket = await getByChannel(channel.id).catch(() => null);
  if (!ticket) {
    await interaction.editReply({ content: 'Ticket not found in DB.' });
    return;
  }

  let info;
  try {
    info = await getTicketInfo(ticket.opener_discord_id);
  } catch (err) {
    log.error('[tickets] info lookup failed:', err);
    await interaction.editReply({ content: 'Failed to fetch user info.' });
    return;
  }

  if (!info.linked) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_INFO)
          .setTitle('ℹ️ Ticket info')
          .setDescription(`<@${ticket.opener_discord_id}> has no linked Chessr account.`),
      ],
    });
    return;
  }

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '📧 Email', value: info.email ?? 'unknown', inline: true },
    { name: '💎 Plan', value: `${info.plan ?? '?'}${info.freetrialUsed ? ' (trial used)' : ''}`, inline: true },
    { name: '🎮 Discord', value: `<@${info.discordId}>`, inline: true },
  ];
  if (info.banned) {
    fields.push({ name: '🚫 Banned', value: info.banReason ?? 'No reason' });
  }
  if (info.linkedAccounts && info.linkedAccounts.length > 0) {
    const lines = info.linkedAccounts.map((a) => {
      const ratings = [
        a.rating_bullet && `🎯${a.rating_bullet}`,
        a.rating_blitz && `⚡${a.rating_blitz}`,
        a.rating_rapid && `⏱️${a.rating_rapid}`,
      ].filter(Boolean).join(' ');
      return `**${a.platform}** ${a.platform_username}${ratings ? ` (${ratings})` : ''}`;
    });
    fields.push({ name: '♟️ Linked accounts', value: lines.join('\n').slice(0, 1024) });
  }
  if (info.fingerprints && info.fingerprints.length > 0) {
    fields.push({
      name: `🖥️ Fingerprints (${info.fingerprints.length})`,
      value: info.fingerprints.map((f) => `\`${f}\``).join(', ').slice(0, 1024),
    });
  }
  if (info.ips && info.ips.length > 0) {
    fields.push({
      name: `🔒 IPs (${info.ips.length})`,
      value: info.ips.map((i) => `\`${i.ip}\` ${i.country ?? ''}`).join('\n').slice(0, 1024),
    });
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_INFO)
        .setTitle(`ℹ️ Ticket info — ${info.email ?? info.discordUsername ?? info.discordId}`)
        .addFields(fields)
        .setFooter({ text: 'Staff only · Chessr.io' })
        .setTimestamp(),
    ],
  });
}

// ─── Permission helper ───────────────────────────────────────────────────

async function ensureAdmin(interaction: ButtonInteraction): Promise<boolean> {
  const member = interaction.member;
  if (member && 'permissions' in member && typeof member.permissions !== 'string') {
    if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  }
  await interaction.reply({
    content: '❌ You don\'t have permission for this action.',
    ephemeral: true,
  }).catch(() => {});
  return false;
}

// ─── Auto-delete event handler ───────────────────────────────────────────

async function handleAutoDelete(client: Client, raw: Record<string, unknown>): Promise<void> {
  const ticketId = Number((raw as { ticketId?: unknown }).ticketId);
  const channelId = String((raw as { channelId?: unknown }).channelId ?? '');
  if (!Number.isFinite(ticketId) || !channelId) return;

  // Best-effort channel.delete(). NotFound (channel already gone) is
  // fine — we still want to flip the DB row.
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (ch && 'delete' in ch) {
      await ch.delete(`Auto-delete after 12h closed window (ticket #${ticketId})`);
      log.info(`[tickets] auto-deleted channel ${channelId} for ticket #${ticketId}`);
    } else {
      log.info(`[tickets] auto-delete: channel ${channelId} already gone (ticket #${ticketId})`);
    }
  } catch (err) {
    log.warn(`[tickets] auto-delete channel.delete failed for ${channelId}:`, err);
  }

  try { await deleteTicket(ticketId, ''); }
  catch (err) { log.warn(`[tickets] auto-delete DB flip failed for #${ticketId}:`, err); }
}

// ─── Wire up the interaction router ──────────────────────────────────────

export function registerTicketHandlers(client: Client): void {
  onEvent('ticket_auto_delete', async (e) => {
    try { await handleAutoDelete(client, e.payload); }
    catch (err) { log.error('[tickets] auto-delete handler threw:', err); }
  });

  client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith(PREFIX)) return;

    try {
      const id = interaction.customId;
      if (id === ID.open) return await handleOpenClick(interaction);
      if (id === ID.closeCancel) return await handleCloseCancel(interaction);

      const close = id.match(/^tk:close:(\d+)$/);
      if (close) return await handleCloseClick(interaction, Number(close[1]));

      const closeConfirm = id.match(/^tk:close-confirm:(\d+)$/);
      if (closeConfirm) return await handleCloseConfirm(interaction, Number(closeConfirm[1]));

      const reopen = id.match(/^tk:reopen:(\d+)$/);
      if (reopen) return await handleReopenClick(interaction, Number(reopen[1]));

      const del = id.match(/^tk:delete:(\d+)$/);
      if (del) return await handleDeleteClick(interaction, Number(del[1]));

      const delConfirm = id.match(/^tk:delete-confirm:(\d+)$/);
      if (delConfirm) return await handleDeleteConfirm(interaction, Number(delConfirm[1]));

      const info = id.match(/^tk:info:(\d+)$/);
      if (info) return await handleInfoClick(interaction, Number(info[1]));
    } catch (err) {
      log.error('[tickets] interaction handler threw:', err);
      const reply = { content: 'Something went wrong.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  });
}
