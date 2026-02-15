import { RouteId } from '../types';

export function detectRoute(url: URL): RouteId {
  const path = url.pathname;

  // /abcd1234 (8 char game id) or /abcd1234/white
  if (/^\/[a-zA-Z0-9]{8}(\/.*)?$/.test(path)) {
    return 'game';
  }

  // /analysis or /analysis/...
  if (path.startsWith('/analysis')) {
    return 'analysis';
  }

  // Home page
  if (path === '/') {
    return 'home';
  }

  return 'unknown';
}
