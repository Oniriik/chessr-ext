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
  logLevel: (optional('LOG_LEVEL') ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;
