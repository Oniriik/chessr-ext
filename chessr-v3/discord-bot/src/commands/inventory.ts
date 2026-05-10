/**
 * /inventory — single entry point for everything wheel-related.
 *
 * The slash command renders the home view (tokens count + rewards list,
 * with three action buttons: Spin / Claim / Gift). Each action runs
 * through a confirm step before mutating anything — boost rewards are
 * irreversible, so an extra click is the cheapest insurance.
 *
 * State machine, all in the same ephemeral message:
 *
 *   home ──[Spin]──> spin:confirm ──[Confirm]──> spin:reveal
 *        │                       └──[Cancel]──> home
 *        │
 *        ──[Claim]─> claim:pickReward ──(select)──> claim:confirm:<rid>
 *        │                                        ──[Confirm]──> claim:result
 *        │                                        ──[Back]─────> claim:pickReward
 *        │
 *        ──[Gift]──> gift:pickReward ──(select)──> gift:pickUser:<rid>
 *                                                ──(select)──> gift:confirm:<rid>:<uid>
 *                                                            ──[Confirm]──> gift:result
 *                                                            ──[Back]─────> gift:pickUser:<rid>
 *
 * Custom IDs encode the state — Discord interactions are stateless on
 * the bot side, so any context we need across clicks is baked into the
 * customId or read fresh from the API.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  EmbedBuilder,
  type Interaction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type StringSelectMenuInteraction,
  type TextChannel,
  UserSelectMenuBuilder,
  type UserSelectMenuInteraction,
} from 'discord.js';
import type { BotCommand } from '../lib/commands.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { claim, getInventory, gift, type Inventory, spin } from '../lib/wheelApi.js';

// ─── Colors ──────────────────────────────────────────────────────────────
const COLOR_HOME      = 0xa855f7;
const COLOR_DAYS      = 0x60a5fa;
const COLOR_LIFETIME  = 0xf59e0b;
const COLOR_SUCCESS   = 0x10b981;
const COLOR_GIFT      = 0xec4899;
const COLOR_ERROR     = 0xef4444;

// ─── customId helpers ────────────────────────────────────────────────────
const PREFIX = 'inv:';
const ID = {
  home:           `${PREFIX}home`,
  spinStart:      `${PREFIX}spin:start`,
  spinConfirm:    `${PREFIX}spin:confirm`,
  claimStart:     `${PREFIX}claim:start`,
  claimPick:      `${PREFIX}claim:pick`,
  claimConfirm:   (id: number) => `${PREFIX}claim:confirm:${id}`,
  giftStart:      `${PREFIX}gift:start`,
  giftPickReward: `${PREFIX}gift:pick:reward`,
  giftNext:       (rid: number) => `${PREFIX}gift:next:${rid}`,
  giftPickUser:   (rid: number) => `${PREFIX}gift:pick:user:${rid}`,
  giftConfirm:    (rid: number, uid: string) => `${PREFIX}gift:confirm:${rid}:${uid}`,
};

// ─── Reward formatting ───────────────────────────────────────────────────

function rewardLabel(r: Inventory['rewards'][number]): string {
  if (r.reward_kind === 'lifetime') return '🌟 Lifetime';
  return `🎁 ${r.reward_days} days`;
}

function rewardSubtitle(r: Inventory['rewards'][number]): string {
  const ago = relativeTime(new Date(r.spun_at));
  if (r.gifted_from_discord_id) {
    return `gifted by <@${r.gifted_from_discord_id}> · ${ago}`;
  }
  return `won ${ago}`;
}

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

// ─── Renderers ───────────────────────────────────────────────────────────

function homeEmbed(inv: Inventory): EmbedBuilder {
  const lines: string[] = [];

  lines.push('### 🎟️ Spin Tokens');
  if (inv.tokens.length === 0) {
    lines.push('_No tokens — boost the server to earn one._');
  } else {
    lines.push(`**${inv.tokens.length}** unused`);
  }
  lines.push('');
  lines.push('### 🎁 Rewards');
  if (inv.rewards.length === 0) {
    lines.push('_None yet — spin a token to start collecting._');
  } else {
    for (const r of inv.rewards.slice(0, 10)) {
      lines.push(`• ${rewardLabel(r)} · ${rewardSubtitle(r)}`);
    }
    if (inv.rewards.length > 10) {
      lines.push(`_…and ${inv.rewards.length - 10} more_`);
    }
  }

  return new EmbedBuilder()
    .setTitle('🎒 Your Inventory')
    .setColor(COLOR_HOME)
    .setDescription(lines.join('\n'));
}

function homeButtons(inv: Inventory): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID.spinStart)
      .setLabel('Spin a token')
      .setEmoji('🎰')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(inv.tokens.length === 0),
    new ButtonBuilder()
      .setCustomId(ID.claimStart)
      .setLabel('Claim')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success)
      .setDisabled(inv.rewards.length === 0),
    new ButtonBuilder()
      .setCustomId(ID.giftStart)
      .setLabel('Gift')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(inv.rewards.length === 0),
  );
}

type RepliableInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ChatInputCommandInteraction;

async function renderHome(interaction: RepliableInteraction): Promise<void> {
  const inv = await getInventory(interaction.user.id);
  await interaction.editReply({
    content: '',
    embeds: [homeEmbed(inv)],
    components: [homeButtons(inv)],
  });
}

// ─── Spin flow ───────────────────────────────────────────────────────────

function spinConfirmEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎰 Confirm spin')
    .setColor(COLOR_HOME)
    .setDescription(
      'Spin the wheel and consume **1 🎟️ token**.\n' +
      'The result is final — no take-backs.',
    );
}

function spinConfirmButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ID.spinConfirm).setLabel('Confirm spin').setEmoji('🎰').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

function backHomeRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ID.home).setLabel('Back to inventory').setEmoji('↩').setStyle(ButtonStyle.Secondary),
  );
}

async function handleSpinConfirm(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: '🎰 Spinning the wheel…',
    embeds: [],
    components: [],
  });
  await new Promise((r) => setTimeout(r, 600));
  await interaction.editReply({ content: '🎲 Rolling…' });
  await new Promise((r) => setTimeout(r, 600));

  let result;
  try {
    result = await spin(interaction.user.id);
  } catch (err) {
    log.error('[inv] spin api failed:', err);
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed("Couldn't spin — try again in a moment.")],
      components: [backHomeRow()],
    });
    return;
  }

  if (!result.spun) {
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed('No tokens left to spin. Boost the server to earn one!')],
      components: [backHomeRow()],
    });
    return;
  }

  const isLifetime = result.rewardKind === 'lifetime';
  const days = result.rewardDays ?? 0;

  const reveal = new EmbedBuilder()
    .setColor(isLifetime ? COLOR_LIFETIME : COLOR_DAYS)
    .setTitle(isLifetime ? '🌟 LIFETIME!' : `🎉 You won ${days} days!`)
    .setDescription(
      isLifetime
        ? '🌟 LIFETIME prize added to your inventory!\nClaim or gift it from your inventory.'
        : `✅ Your **${days} days** prize has been added to your inventory.\nClaim or gift it from your inventory.`,
    );
  await interaction.editReply({ content: '', embeds: [reveal], components: [backHomeRow()] });

  // Public ping in #general — separate so the channel sees the reveal
  // even if the spinner closes the ephemeral.
  const channelId = config.discord.boostChannelId;
  if (!channelId) {
    log.warn('[inv] DISCORD_BOOST_CHANNEL_ID not set — skipping spin public ping');
    return;
  }
  try {
    const ch = await interaction.client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased() || !('send' in ch)) {
      log.warn(`[inv] boost channel ${channelId} not reachable / not text-based`);
      return;
    }
    const msg = isLifetime
      ? `🌟 <@${interaction.user.id}> just hit the **LIFETIME** jackpot on the wheel! 1 spin in 1000.`
      : `🎉 <@${interaction.user.id}> spun and won **${days} days**!`;
    await (ch as TextChannel).send({
      content: msg,
      allowedMentions: { users: [interaction.user.id] },
    });
    log.info(`[inv] spin public ping sent (${interaction.user.id} → ${isLifetime ? 'lifetime' : `${days}d`})`);
  } catch (err) {
    log.warn('[inv] public spin ping failed:', err);
  }
}

// ─── Claim flow ──────────────────────────────────────────────────────────

async function renderClaimPick(interaction: ButtonInteraction): Promise<void> {
  const inv = await getInventory(interaction.user.id);
  if (inv.rewards.length === 0) {
    await interaction.update({
      content: '',
      embeds: [errorEmbed('No rewards to claim.')],
      components: [backHomeRow()],
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(ID.claimPick)
    .setPlaceholder('Select a reward to claim…')
    .addOptions(
      inv.rewards.slice(0, 25).map((r) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(rewardLabel(r))
          .setDescription(rewardSubtitle(r).slice(0, 100))
          .setValue(String(r.id)),
      ),
    );

  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('🎁 Claim a reward')
        .setColor(COLOR_HOME)
        .setDescription('Pick which reward to apply to your Chessr account:'),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleClaimSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const rewardId = Number(interaction.values[0]);
  const inv = await getInventory(interaction.user.id);
  const reward = inv.rewards.find((r) => r.id === rewardId);
  if (!reward) {
    await interaction.update({
      content: '',
      embeds: [errorEmbed('Reward not found in your inventory anymore.')],
      components: [backHomeRow()],
    });
    return;
  }

  // Keep the dropdown visible (with the picked option highlighted) and
  // surface a [Claim] button below. Selection alone doesn't fire the
  // claim — the user has to click the button. Picking a different option
  // re-runs this handler and updates the embed + button customId.
  const select = new StringSelectMenuBuilder()
    .setCustomId(ID.claimPick)
    .setPlaceholder('Select a reward to claim…')
    .addOptions(
      inv.rewards.slice(0, 25).map((r) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(rewardLabel(r))
          .setDescription(rewardSubtitle(r).slice(0, 100))
          .setValue(String(r.id))
          .setDefault(r.id === rewardId),
      ),
    );

  const description = reward.reward_kind === 'lifetime'
    ? `Selected: **${rewardLabel(reward)}**\n\nLifetime rewards are processed manually — clicking Claim will tell you where to open a ticket.`
    : `Selected: **${rewardLabel(reward)}**\n\n**${reward.reward_days} days** of Chessr Premium will be added to your account when you click Claim.`;

  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('🎁 Claim a reward')
        .setColor(COLOR_HOME)
        .setDescription(description),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.claimConfirm(rewardId)).setLabel('Claim').setEmoji('🎁').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleClaimConfirm(interaction: ButtonInteraction, rewardId: number): Promise<void> {
  await interaction.update({
    content: 'Applying claim…',
    embeds: [],
    components: [],
  });

  let result;
  try {
    result = await claim(rewardId, interaction.user.id);
  } catch (err) {
    log.error('[inv] claim api failed:', err);
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed("Couldn't apply the claim — try again in a moment.")],
      components: [backHomeRow()],
    });
    return;
  }

  // Lifetime → bot redirects to ticket channel. Reward stays unclaimed.
  if (result.error === 'lifetime_manual') {
    const ticketId = config.discord.ticketChannelId;
    const channelMention = ticketId ? `<#${ticketId}>` : 'the support channel';
    await interaction.editReply({
      content: '',
      embeds: [
        new EmbedBuilder()
          .setTitle('🌟 Lifetime claim')
          .setColor(COLOR_LIFETIME)
          .setDescription(
            'Lifetime rewards are processed by hand.\n' +
            `Open a ticket in ${channelMention} with this reward ID — an admin will activate it within 24h.\n\n` +
            `**Reward ID:** \`#${rewardId}\``,
          ),
      ],
      components: [backHomeRow()],
    });
    return;
  }

  if (result.error === 'not_linked') {
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed(
        'Link your Discord on **chessr.io** first, then come back to claim.\n' +
        'Your reward stays in your inventory.',
      )],
      components: [backHomeRow()],
    });
    return;
  }
  if (result.error === 'plan_no_extend') {
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed(
        `You already have **${result.plan ?? 'lifetime'}** access — no expiry to extend.\n` +
        'Tip: gift this reward to a friend instead!',
      )],
      components: [backHomeRow()],
    });
    return;
  }
  if (result.error === 'not_owner_or_already_claimed' || result.error === 'claim_race_lost') {
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed('This reward was already claimed.')],
      components: [backHomeRow()],
    });
    return;
  }
  if (result.error) {
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed(result.message ?? 'Something went wrong.')],
      components: [backHomeRow()],
    });
    return;
  }

  // Success path.
  const tail =
    result.rewardPath === 'paddle'
      ? 'Your subscription renewal date has been pushed back.'
      : 'Premium added directly to your Chessr account.';
  await interaction.editReply({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('✅ Claimed!')
        .setColor(COLOR_SUCCESS)
        .setDescription(`+${result.rewardDays} days of Chessr Premium.\n${tail}`),
    ],
    components: [backHomeRow()],
  });
}

// ─── Gift flow ───────────────────────────────────────────────────────────

async function renderGiftPickReward(interaction: ButtonInteraction): Promise<void> {
  const inv = await getInventory(interaction.user.id);
  if (inv.rewards.length === 0) {
    await interaction.update({
      content: '',
      embeds: [errorEmbed('No rewards to gift.')],
      components: [backHomeRow()],
    });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(ID.giftPickReward)
    .setPlaceholder('Select a reward to gift…')
    .addOptions(
      inv.rewards.slice(0, 25).map((r) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(rewardLabel(r))
          .setDescription(rewardSubtitle(r).slice(0, 100))
          .setValue(String(r.id)),
      ),
    );

  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('📤 Gift a reward')
        .setColor(COLOR_GIFT)
        .setDescription('Step 1 of 2 — pick a reward to gift:'),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleGiftPickReward(interaction: StringSelectMenuInteraction): Promise<void> {
  const rewardId = Number(interaction.values[0]);
  const inv = await getInventory(interaction.user.id);
  const reward = inv.rewards.find((r) => r.id === rewardId);
  if (!reward) {
    await interaction.update({
      content: '',
      embeds: [errorEmbed('Reward not found in your inventory anymore.')],
      components: [backHomeRow()],
    });
    return;
  }

  // Stay on the same step — keep the dropdown visible (with the picked
  // option highlighted) and reveal a [Continue] button. Picking a
  // different option re-runs this handler with a fresh button customId.
  const select = new StringSelectMenuBuilder()
    .setCustomId(ID.giftPickReward)
    .setPlaceholder('Select a reward to gift…')
    .addOptions(
      inv.rewards.slice(0, 25).map((r) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(rewardLabel(r))
          .setDescription(rewardSubtitle(r).slice(0, 100))
          .setValue(String(r.id))
          .setDefault(r.id === rewardId),
      ),
    );

  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('📤 Gift a reward')
        .setColor(COLOR_GIFT)
        .setDescription(`Step 1 of 2 — selected: **${rewardLabel(reward)}**\n\nClick Continue to choose a recipient.`),
    ],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.giftNext(rewardId)).setLabel('Continue').setEmoji('▶').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

/** Step 1.5 → 2: user clicked [Continue] after picking a reward.
 *  Now show the recipient picker. */
async function handleGiftNext(interaction: ButtonInteraction, rewardId: number): Promise<void> {
  const inv = await getInventory(interaction.user.id);
  const reward = inv.rewards.find((r) => r.id === rewardId);
  if (!reward) {
    await interaction.update({
      content: '',
      embeds: [errorEmbed('Reward not found in your inventory anymore.')],
      components: [backHomeRow()],
    });
    return;
  }

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(ID.giftPickUser(rewardId))
    .setPlaceholder('Select a user…')
    .setMinValues(1)
    .setMaxValues(1);

  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle(`📤 Gift ${rewardLabel(reward)}`)
        .setColor(COLOR_GIFT)
        .setDescription('Step 2 of 2 — pick the recipient:'),
    ],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.giftStart).setLabel('Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleGiftPickUser(interaction: UserSelectMenuInteraction, rewardId: number): Promise<void> {
  const targetId = interaction.values[0];

  // Self / bot guards — return them to the picker with an error
  // message so they can pick someone else.
  if (targetId === interaction.user.id || interaction.users?.get(targetId)?.bot) {
    const reason = targetId === interaction.user.id ? "You can't gift to yourself." : "You can't gift to a bot.";
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(ID.giftPickUser(rewardId))
      .setPlaceholder('Select a user…')
      .setMinValues(1).setMaxValues(1);
    await interaction.update({
      content: '',
      embeds: [errorEmbed(reason)],
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(ID.giftStart).setLabel('Back').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  const inv = await getInventory(interaction.user.id);
  const reward = inv.rewards.find((r) => r.id === rewardId);
  if (!reward) {
    await interaction.update({
      content: '',
      embeds: [errorEmbed('Reward not found in your inventory anymore.')],
      components: [backHomeRow()],
    });
    return;
  }

  // Same pattern as the reward pick: keep the user-select dropdown
  // visible with the chosen recipient pre-filled, reveal an explicit
  // [Send gift] button. The customId carries both ids so the click
  // handler doesn't need to look anything up.
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(ID.giftPickUser(rewardId))
    .setPlaceholder('Select a user…')
    .setDefaultUsers([targetId])
    .setMinValues(1).setMaxValues(1);

  await interaction.update({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle(`📤 Gift ${rewardLabel(reward)}`)
        .setColor(COLOR_GIFT)
        .setDescription(`Recipient: <@${targetId}>\n\nClick Send gift to confirm.`),
    ],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(ID.giftConfirm(rewardId, targetId)).setLabel('Send gift').setEmoji('📤').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(ID.giftStart).setLabel('Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(ID.home).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

async function handleGiftConfirm(interaction: ButtonInteraction, rewardId: number, targetId: string): Promise<void> {
  await interaction.update({ content: 'Sending gift…', embeds: [], components: [] });

  // Snapshot the reward BEFORE the gift fires — the gift API only
  // returns { gifted: true } and the row's owner_discord_id has flipped
  // to the recipient by the time we'd query again. We need the kind +
  // days for the public announcement.
  const inv = await getInventory(interaction.user.id);
  const reward = inv.rewards.find((r) => r.id === rewardId);
  const rewardWord = reward
    ? reward.reward_kind === 'lifetime' ? 'Lifetime' : `${reward.reward_days} days`
    : 'a reward';

  let result;
  try {
    result = await gift(rewardId, interaction.user.id, targetId);
  } catch (err) {
    log.error('[inv] gift api failed:', err);
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed("Couldn't send the gift — try again in a moment.")],
      components: [backHomeRow()],
    });
    return;
  }

  if (!result.gifted) {
    const msg = result.error === 'cannot_gift_to_self'
      ? "You can't gift to yourself."
      : 'This reward was already claimed or no longer yours.';
    await interaction.editReply({
      content: '',
      embeds: [errorEmbed(msg)],
      components: [backHomeRow()],
    });
    return;
  }

  await interaction.editReply({
    content: '',
    embeds: [
      new EmbedBuilder()
        .setTitle('📤 Gift sent!')
        .setColor(COLOR_GIFT)
        .setDescription(`Sent **${rewardWord}** to <@${targetId}>. They can claim it from their \`/inventory\`.`),
    ],
    components: [backHomeRow()],
  });

  // Public ping — channel sees the gift, recipient is mentioned so
  // they know to check their inventory.
  const channelId = config.discord.boostChannelId;
  if (!channelId) {
    log.warn('[inv] DISCORD_BOOST_CHANNEL_ID not set — skipping gift public ping');
    return;
  }
  try {
    const ch = await interaction.client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased() || !('send' in ch)) {
      log.warn(`[inv] boost channel ${channelId} not reachable / not text-based`);
      return;
    }
    await (ch as TextChannel).send({
      content: `🎁 <@${interaction.user.id}> gifted **${rewardWord}** to <@${targetId}>!`,
      allowedMentions: { users: [targetId, interaction.user.id] },
    });
    log.info(`[inv] gift public ping sent (${interaction.user.id} → ${targetId}, ${rewardWord})`);
  } catch (err) {
    log.warn('[inv] public gift ping failed:', err);
  }
}

// ─── Misc ────────────────────────────────────────────────────────────────

function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLOR_ERROR).setDescription(message);
}

// ─── Slash command + interaction router ──────────────────────────────────

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('See your spin tokens and rewards'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      await renderHome(interaction);
    } catch (err) {
      log.error('[inv] /inventory failed:', err);
      await interaction.editReply({
        content: '',
        embeds: [errorEmbed("Couldn't load your inventory — try again in a moment.")],
      });
    }
  },
};

/** Registers the button + select-menu handlers on the client.
 *  Called once at boot, separate from the slash registration so the
 *  command list and the dispatch are de-coupled. */
export function registerInventoryHandlers(client: Client): void {
  client.on('interactionCreate', async (interaction: Interaction) => {
    try {
      if (interaction.isButton())             await routeButton(interaction);
      else if (interaction.isStringSelectMenu()) await routeStringSelect(interaction);
      else if (interaction.isUserSelectMenu())   await routeUserSelect(interaction);
    } catch (err) {
      log.error('[inv] interaction handler threw:', err);
    }
  });
}

async function routeButton(i: ButtonInteraction): Promise<void> {
  const id = i.customId;
  if (!id.startsWith(PREFIX)) return;

  if (id === ID.home)        return renderHome((await deferUpdate(i), i));
  if (id === ID.spinStart)   return spinStart(i);
  if (id === ID.spinConfirm) return handleSpinConfirm(i);
  if (id === ID.claimStart)  return renderClaimPick(i);
  if (id === ID.giftStart)   return renderGiftPickReward(i);

  if (id.startsWith(`${PREFIX}claim:confirm:`)) {
    const rewardId = Number(id.slice(`${PREFIX}claim:confirm:`.length));
    return handleClaimConfirm(i, rewardId);
  }
  if (id.startsWith(`${PREFIX}gift:next:`)) {
    const rewardId = Number(id.slice(`${PREFIX}gift:next:`.length));
    return handleGiftNext(i, rewardId);
  }
  if (id.startsWith(`${PREFIX}gift:confirm:`)) {
    const rest = id.slice(`${PREFIX}gift:confirm:`.length);
    const colon = rest.indexOf(':');
    if (colon > 0) {
      const rewardId = Number(rest.slice(0, colon));
      const targetId = rest.slice(colon + 1);
      return handleGiftConfirm(i, rewardId, targetId);
    }
  }
}

async function routeStringSelect(i: StringSelectMenuInteraction): Promise<void> {
  if (i.customId === ID.claimPick)      return handleClaimSelect(i);
  if (i.customId === ID.giftPickReward) return handleGiftPickReward(i);
}

async function routeUserSelect(i: UserSelectMenuInteraction): Promise<void> {
  const id = i.customId;
  if (id.startsWith(`${PREFIX}gift:pick:user:`)) {
    const rewardId = Number(id.slice(`${PREFIX}gift:pick:user:`.length));
    return handleGiftPickUser(i, rewardId);
  }
}

async function spinStart(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: '',
    embeds: [spinConfirmEmbed()],
    components: [spinConfirmButtons()],
  });
}

/** Helper: deferUpdate → renderHome flow uses the original ephemeral
 *  reply, so we use update() + editReply downstream. */
async function deferUpdate(i: ButtonInteraction): Promise<void> {
  if (!i.deferred && !i.replied) {
    await i.deferUpdate();
  }
}
