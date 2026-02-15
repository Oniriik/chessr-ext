# Mounting System

[← Back to summary](./README.md)

## Overview

The mounting system handles injecting React components into specific locations in the host page's DOM.

## MountPoint Interface

```typescript
interface MountPoint {
  id: string;                              // Unique identifier
  route: RouteId | RouteId[];              // Route(s) where this mount applies
  selector: string;                        // CSS selector for target element
  position: 'before' | 'after' | 'prepend' | 'append';
  component: ComponentType<any>;           // React component to render
  props?: Record<string, unknown>;         // Props to pass to component
  parentStyles?: Partial<CSSStyleDeclaration>; // Styles for parent element
}
```

## Position Options

```
┌─────────────────────────────────────┐
│           Parent Element            │
│  ┌───────────────────────────────┐  │
│  │   'prepend' inserts here      │  │
│  ├───────────────────────────────┤  │
│  │                               │  │
│  │      Target Element           │  │
│  │                               │  │
│  ├───────────────────────────────┤  │
│  │   'append' inserts here       │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘

'before' inserts as sibling BEFORE target
'after' inserts as sibling AFTER target
```

## Mount Process

```typescript
// content/index.tsx

function mountComponent(mountPoint: MountPoint, context: PlatformContext) {
  // 1. Find target element
  const targetElement = document.querySelector(mountPoint.selector);
  if (!targetElement) return;

  // 2. Skip if already mounted
  if (mountedRoots.has(mountPoint.id)) return;

  // 3. Create container
  const container = document.createElement('div');
  container.id = `chessr-${mountPoint.id}`;
  container.className = 'chessr-mount';

  // 4. Insert at position
  switch (mountPoint.position) {
    case 'before':
      targetElement.parentNode?.insertBefore(container, targetElement);
      break;
    case 'after':
      targetElement.parentNode?.insertBefore(container, targetElement.nextSibling);
      break;
    case 'prepend':
      targetElement.insertBefore(container, targetElement.firstChild);
      break;
    case 'append':
      targetElement.appendChild(container);
      break;
  }

  // 5. Apply parent styles if specified
  if (mountPoint.parentStyles && parentForStyles instanceof HTMLElement) {
    Object.assign(parentForStyles.style, mountPoint.parentStyles);
  }

  // 6. Create React root and render
  const root = createRoot(container);
  root.render(
    <PlatformProvider value={context}>
      <Component {...props} />
    </PlatformProvider>
  );

  // 7. Track mounted root
  mountedRoots.set(mountPoint.id, { root, container });
}
```

## Unmount Process

```typescript
function unmountComponent(mountPointId: string) {
  const mounted = mountedRoots.get(mountPointId);
  if (!mounted) return;

  mounted.root.unmount();
  mounted.container.remove();
  mountedRoots.delete(mountPointId);
}
```

## CSS: display: contents

The mount container uses `display: contents` to be transparent to layout:

```css
.chessr-mount {
  display: contents;
}
```

This means the container's children behave as if they were direct children of the container's parent, preserving flex/grid layouts.

## Route Matching

A mount point can target:
- A single route: `route: 'play-computer'`
- Multiple routes: `route: ['home', 'analysis', 'game']`

```typescript
function matchesRoute(mountRoute: RouteId | RouteId[], currentRoute: RouteId): boolean {
  if (Array.isArray(mountRoute)) {
    return mountRoute.includes(currentRoute);
  }
  return mountRoute === currentRoute;
}
```

## Update Loop

The system continuously watches for changes:

```typescript
// Initial mount
updateMounts();

// Watch for URL changes (SPA navigation)
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    updateMounts();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Also listen for popstate (back/forward navigation)
window.addEventListener('popstate', updateMounts);
```
