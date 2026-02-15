# Platforms

[← Back to summary](./README.md)

## Multi-Platform System

The extension supports multiple chess websites with an adapter architecture.

## Structure

```
platforms/
├── index.ts           # Exports + getPlatformContext()
├── types.ts           # Shared interfaces
├── chesscom/
│   ├── index.ts       # Platform export
│   ├── routes.ts      # Route detection
│   └── mounts.ts      # Mount points
└── lichess/
    ├── index.ts
    ├── routes.ts
    └── mounts.ts
```

## Types

```typescript
// types.ts

type PlatformId = 'chesscom' | 'lichess';

type RouteId =
  | 'game'
  | 'play-computer'
  | 'play-online'
  | 'analysis'
  | 'home'
  | 'unknown';

interface Platform {
  id: PlatformId;
  name: string;
  hostname: RegExp;
  detectRoute: (url: URL) => RouteId;
  getMountPoints: () => MountPoint[];
}

interface PlatformContext {
  platform: Platform;
  route: RouteId;
  url: URL;
}
```

## Platform Detection

```typescript
// platforms/index.ts

const platforms: Platform[] = [chesscom, lichess];

export function getPlatformContext(url: URL): PlatformContext | null {
  for (const platform of platforms) {
    if (platform.hostname.test(url.hostname)) {
      return {
        platform,
        route: platform.detectRoute(url),
        url,
      };
    }
  }
  return null;
}
```

## Chess.com

### Routes

```typescript
// chesscom/routes.ts

export function detectRoute(url: URL): RouteId {
  const path = url.pathname;

  // /play/computer or /fr/play/computer (with locale)
  if (/^(\/[a-z]{2})?\/play\/computer/.test(path)) {
    return 'play-computer';
  }

  // /play/online or /fr/play/online
  if (/^(\/[a-z]{2})?\/play\/online/.test(path)) {
    return 'play-online';
  }

  // /game/live/123 or /game/daily/123
  if (path.startsWith('/game/')) {
    return 'game';
  }

  // /analysis
  if (path.startsWith('/analysis')) {
    return 'analysis';
  }

  // Home
  if (path === '/' || path === '/home') {
    return 'home';
  }

  return 'unknown';
}
```

### Mount Points

```typescript
// chesscom/mounts.ts

export function getMountPoints(): MountPoint[] {
  return [
    // Trigger in navigation sidebar (all pages)
    {
      id: 'base-sidebar-trigger',
      route: ['home', 'play-computer', 'play-online', 'analysis', 'game', 'unknown'],
      selector: '.sidebar-link[data-user-activity-key="profile"]',
      position: 'after',
      component: BaseSidebarTrigger,
    },
    // Floating sidebar (pages without dedicated sidebar)
    {
      id: 'floating-sidebar',
      route: ['home', 'analysis', 'game', 'unknown'],
      selector: 'body',
      position: 'append',
      component: FloatingSidebar,
    },
    // Pages with dedicated sidebar
    {
      id: 'play-computer-toggle',
      route: 'play-computer',
      selector: '#player-bottom .player-row-container',
      position: 'after',
      component: SidebarMount,
      props: {
        originalSidebarSelector: '#board-layout-sidebar',
        inheritClass: 'board-layout-sidebar',
      },
    },
    // ...
  ];
}
```

## Adding a New Platform

1. Create the folder `platforms/newsite/`
2. Implement `routes.ts` with `detectRoute()`
3. Implement `mounts.ts` with `getMountPoints()`
4. Create `index.ts` exporting the `Platform` object
5. Add to the list in `platforms/index.ts`
6. Update `manifest.json` with the URLs
