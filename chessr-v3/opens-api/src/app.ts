import { Hono } from 'hono';
import { openingsRouter } from './routes/openings.js';
import { positionRouter } from './routes/position.js';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/openings', openingsRouter);
app.route('/position', positionRouter);

export default app;
