import 'dotenv/config';

// Read & validate env once at startup. Failing fast here beats having a
// command call fall over with `undefined.something` 10 minutes into the
// bot's life.
function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export const config = {
  discord: {
    token:    required('DISCORD_BOT_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    /** When set, slash commands register guild-scoped (instant). When
     *  empty, they register globally (≈1h propagation). */
    guildId:  optional('DISCORD_GUILD_ID'),
    /** Channel where /lookup posts the resulting embed so any admin
     *  can read it. When unset the command falls back to an ephemeral
     *  reply visible only to the caller. */
    lookupChannelId: optional('DISCORD_LOOKUP_CHANNEL_ID'),
    /** Channel where the bot posts the public "thanks for boosting"
     *  message and the wheel-spin reveal pings. Typically #general. */
    boostChannelId: optional('DISCORD_BOOST_CHANNEL_ID'),
    /** Channel where the ticket panel embed is posted via /ticket-setup
     *  and where users click "Open a ticket". Also referenced by the
     *  wheel's lifetime claim flow as "open a support ticket here". */
    ticketChannelId: optional('DISCORD_TICKET_CHANNEL_ID'),
    /** Category that newly-opened ticket channels are filed under. The
     *  bot creates them under this parent so admins can configure perms
     *  once at the category level. */
    ticketOpenCategoryId: optional('DISCORD_TICKET_OPEN_CATEGORY_ID'),
    /** Category for closed tickets — the bot moves channels here on
     *  close, and admins can scan/delete from one place. */
    ticketClosedCategoryId: optional('DISCORD_TICKET_CLOSED_CATEGORY_ID'),
    /** Default channel where giveaway announcements get posted. The
     *  giveaway row can override this; when neither is set the bot
     *  logs a warning and skips the announcement (giveaway stays
     *  pending until configured). */
    giveawayChannelId: optional('DISCORD_GIVEAWAY_CHANNEL_ID'),
    /** Mod channels — see handlers/eventForwarder.ts for the routing
     *  table. Each is optional; unset = silently skip that channel
     *  group instead of erroring. */
    mod: {
      subscriptions: optional('DISCORD_MOD_SUBSCRIPTIONS_CHANNEL_ID'),
      users:         optional('DISCORD_MOD_USERS_CHANNEL_ID'),
      security:      optional('DISCORD_MOD_SECURITY_CHANNEL_ID'),
    },
    /** Stats voice channels — names are rewritten on a 10-min cadence.
     *  Discord caps channel renames at 2 per 10 min per channel, so we
     *  stagger updates with 1-minute offsets between channels. Any
     *  unset ID is silently skipped — partial setup is fine. */
    statsChannels: {
      users:    optional('DISCORD_STATS_USERS_CHANNEL_ID'),
      playing:  optional('DISCORD_STATS_PLAYING_CHANNEL_ID'),
      moves:    optional('DISCORD_STATS_MOVES_CHANNEL_ID'),
      premium:  optional('DISCORD_STATS_PREMIUM_CHANNEL_ID'),
    },
  },
  supabase: {
    url:        required('SUPABASE_URL'),
    serviceKey: required('SUPABASE_SERVICE_KEY'),
  },
  redis: {
    host:     optional('REDIS_HOST') ?? '127.0.0.1',
    port:     Number(optional('REDIS_PORT') ?? 6379),
    password: optional('REDIS_PASSWORD'),
  },
  serveur: {
    url:        optional('SERVEUR_URL') ?? 'http://localhost:8080',
    adminToken: optional('SERVEUR_ADMIN_TOKEN') ?? '',
  },
  // Plan → role-id map. Empty / unset means "this tier has no role"
  // (sync just removes any of the others when entering it). Free is a
  // real role here: linked-but-free users keep visibility of their
  // tier on Discord. "No role at all" is reserved for the unlinked /
  // deleted state, handled by passing null to syncPlanRole.
  planRoles: {
    free:      optional('DISCORD_ROLE_ID_FREE'),
    freetrial: optional('DISCORD_ROLE_ID_FREETRIAL'),
    premium:   optional('DISCORD_ROLE_ID_PREMIUM'),
    beta:      optional('DISCORD_ROLE_ID_BETA'),
    lifetime:  optional('DISCORD_ROLE_ID_LIFETIME'),
    unlocker:  optional('DISCORD_ROLE_ID_UNLOCKER'),
  } as Record<string, string | undefined>,
  // ELO bracket → role-id map. Brackets are mutually exclusive and
  // assigned from the highest rating across the user's linked chess
  // accounts (bullet / blitz / rapid). The bracket boundary keys
  // (0 / 800 / 1000 / ... / 2000) match the v2 bot's ELO_BRACKETS
  // table — see lib/discordRoles.ts for the matching logic.
  eloRoles: {
    '0':    optional('DISCORD_ROLE_ELO_0'),
    '800':  optional('DISCORD_ROLE_ELO_800'),
    '1000': optional('DISCORD_ROLE_ELO_1000'),
    '1200': optional('DISCORD_ROLE_ELO_1200'),
    '1400': optional('DISCORD_ROLE_ELO_1400'),
    '1600': optional('DISCORD_ROLE_ELO_1600'),
    '1800': optional('DISCORD_ROLE_ELO_1800'),
    '2000': optional('DISCORD_ROLE_ELO_2000'),
  } as Record<string, string | undefined>,
  logLevel: (optional('LOG_LEVEL') ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;
