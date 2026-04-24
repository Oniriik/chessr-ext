/**
 * Shared Redis connection used by every BullMQ Queue / Worker / QueueEvents
 * in the server. ioredis `maxRetriesPerRequest: null` is required by BullMQ
 * (see https://docs.bullmq.io/guide/going-to-production).
 */

import { Redis } from 'ioredis';

const host = process.env.REDIS_HOST || '127.0.0.1';
const port = Number(process.env.REDIS_PORT) || 6379;
const password = process.env.REDIS_PASSWORD || undefined;

export const redis = new Redis({
  host,
  port,
  password,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on('error', (err) => {
  console.error('[Redis] connection error:', err.message);
});

redis.on('connect', () => {
  console.log(`[Redis] connected to ${host}:${port}`);
});
