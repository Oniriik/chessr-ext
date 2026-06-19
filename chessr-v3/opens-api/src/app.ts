import { Hono } from 'hono';
import { openingsRouter } from './routes/openings.js';
import { positionRouter } from './routes/position.js';
import { gameRouter } from './routes/game.js';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/openings', openingsRouter);
app.route('/position', positionRouter);
app.route('/game', gameRouter);

export default app;
