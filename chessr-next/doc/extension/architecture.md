# Architecture

[← Back to summary](./README.md)

## Overview

The Chessr extension uses a modular architecture based on:

1. **Content Script** - Injected into chess.com/lichess pages
2. **Platform Adapters** - Site detection and adaptation
3. **Mount System** - React component injection into the DOM
4. **Shared State** - Global state shared between components

```
┌─────────────────────────────────────────────────────────┐
│                     Web Page (chess.com)                │
├─────────────────────────────────────────────────────────┤
│  Content Script (content/index.tsx)                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Platform Detection                              │   │
│  │  └── getPlatformContext(url)                     │   │
│  └─────────────────────────────────────────────────┘   │
│              ↓                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Mount System                                    │   │
│  │  └── mountComponent() for each MountPoint       │   │
│  └─────────────────────────────────────────────────┘   │
│              ↓                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ React Root 1 │  │ React Root 2 │  │ React Root 3 │  │
│  │ (Trigger)    │  │ (Sidebar)    │  │ (Floating)   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│              ↓              ↓              ↓            │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Zustand Store (shared state via localStorage)  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Execution Flow

### 1. Content Script Injection

The content script is automatically injected by Chrome on configured sites in `manifest.json`:

```json
{
  "content_scripts": [{
    "matches": ["*://chess.com/*", "*://*.chess.com/*", "*://lichess.org/*"],
    "js": ["content.js"],
    "css": ["content.css"]
  }]
}
```

### 2. Platform Detection

```typescript
// content/index.tsx
const url = new URL(window.location.href);
const context = getPlatformContext(url);
// → { platform: chesscom, route: 'play-computer', url }
```

### 3. Component Mounting

For each `MountPoint` matching the current route:

```typescript
for (const mountPoint of mountPoints) {
  if (matchesRoute(mountPoint.route, currentRoute)) {
    mountComponent(mountPoint, context);
  }
}
```

### 4. Change Observation

A `MutationObserver` watches for DOM and URL changes to:
- Remount components if the DOM changes (SPA navigation)
- Unmount components if the route changes

## Multiple React Roots

The extension creates **multiple independent React roots**:
- One for the trigger in the navigation sidebar
- One for the Chessr sidebar (portal or floating)
- Potentially others for future widgets

These roots share state via **Zustand + localStorage**.
