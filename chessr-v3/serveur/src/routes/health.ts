import type { Hono } from 'hono';

const MIN_EXTENSION_VERSION = '3.0.6';

export function registerHealthRoutes(app: Hono) {
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      serverVersion: '3.0.0',
      minExtensionVersion: MIN_EXTENSION_VERSION,
    }),
  );
}
