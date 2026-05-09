import { Redis } from 'ioredis';
import { config } from '../config.js';
import { log } from './logger.js';

// Two clients: one for blocking subscribe, one for everything else.
// ioredis enters subscriber mode after the first SUBSCRIBE — that
// connection can no longer issue regular commands. Splitting from the
// start avoids surprises later.

function makeClient(label: string): Redis {
  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  client.on('error', (err) => log.error(`[redis:${label}] error:`, err.message));
  client.on('connect', () => log.info(`[redis:${label}] connected to ${config.redis.host}:${config.redis.port}`));
  return client;
}

export const redis = makeClient('cmd');
export const redisSub = makeClient('sub');
