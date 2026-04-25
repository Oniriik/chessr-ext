// Tiny Bull Board server with proper basePath so it can be reverse-proxied
// under /queues/board/* without absolute-URL chaos. Auth is enforced at
// the nginx + Next.js middleware layer (Supabase session) — this process
// trusts whatever reaches it.

import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const PORT = Number(process.env.PORT) || 3000;
const BASE_PATH = process.env.BASE_PATH || '/queues/board';
const QUEUE_NAMES = (process.env.QUEUE_NAMES || 'suggestion,analysis,maia')
  .split(',').map((s) => s.trim()).filter(Boolean);

const connection = { host: REDIS_HOST, port: REDIS_PORT, maxRetriesPerRequest: null };
const queues = QUEUE_NAMES.map((name) => new BullMQAdapter(new Queue(name, { connection })));

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(BASE_PATH);
createBullBoard({ queues, serverAdapter });

const app = express();
app.use(BASE_PATH, serverAdapter.getRouter());
// health probe
app.get('/_health', (_req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`[bullboard] listening on :${PORT} basePath=${BASE_PATH} queues=${QUEUE_NAMES.join(',')}`);
});
