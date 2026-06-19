import { serve } from '@hono/node-server';
import app from './app.js';

const PORT = parseInt(process.env.PORT ?? '3900', 10);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`opens-api listening on :${PORT}`);
});
