import type { Hono } from 'hono';

// Both env-driven so we can roll a force-update or repoint the
// download URL without rebuilding the serveur image. Edit .env on the
// VPS + `docker compose up -d serveur` to apply.
//   MIN_EXTENSION_VERSION       e.g. "3.0.17"
//   EXTENSION_DOWNLOAD_URL      e.g. "https://download.chessr.io/chessr-3.0.17.zip"
//                               or a redirect like "https://chessr.io/download"
const MIN_EXTENSION_VERSION = process.env.MIN_EXTENSION_VERSION ?? '3.0.17';
const EXTENSION_DOWNLOAD_URL = process.env.EXTENSION_DOWNLOAD_URL ?? 'https://download.chessr.io/latest';

export function registerHealthRoutes(app: Hono) {
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      serverVersion: '3.0.0',
      minExtensionVersion: MIN_EXTENSION_VERSION,
      downloadUrl: EXTENSION_DOWNLOAD_URL,
    }),
  );
}
