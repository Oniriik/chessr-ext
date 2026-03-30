import { RouteId } from '../types';

export function detectRoute(url: URL): RouteId {
  const path = url.pathname;

  // /game/{uuid} or /{locale}/game/{uuid}
  if (/^(\/[a-z]{2})?\/game\/[0-9a-f-]+/i.test(path)) {
    return 'game';
  }

  // /puzzles
  if (/^(\/[a-z]{2})?\/puzzles/.test(path)) {
    return 'puzzle';
  }

  // /lobby
  if (/^(\/[a-z]{2})?\/lobby/.test(path)) {
    return 'home';
  }

  // Home page
  if (path === '/' || /^\/[a-z]{2}\/?$/.test(path)) {
    return 'home';
  }

  return 'unknown';
}
