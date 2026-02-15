import { RouteId } from '../types';

export function detectRoute(url: URL): RouteId {
  const path = url.pathname;

  // /play/computer or /fr/play/computer (with locale)
  if (/^(\/[a-z]{2})?\/play\/computer/.test(path)) {
    return 'play-computer';
  }

  // /play/online or /fr/play/online (with locale)
  if (/^(\/[a-z]{2})?\/play\/online/.test(path)) {
    return 'play-online';
  }

  // /game/live/123 or /game/daily/123
  if (path.startsWith('/game/')) {
    return 'game';
  }

  // /analysis or /analysis/...
  if (path.startsWith('/analysis')) {
    return 'analysis';
  }

  // Home page
  if (path === '/' || path === '/home') {
    return 'home';
  }

  return 'unknown';
}
