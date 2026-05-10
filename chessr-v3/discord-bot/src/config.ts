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
  } as Record<string, string | undefined>,
  logLevel: (optional('LOG_LEVEL') ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;
