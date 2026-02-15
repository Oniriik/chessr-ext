# State Management

[← Back to summary](./README.md)

## Overview

State is managed with **Zustand** and persisted to **localStorage** for cross-navigation persistence.

## Challenge: Multiple React Roots

The extension creates multiple independent React roots. They need to share state.

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ React Root 1 │  │ React Root 2 │  │ React Root 3 │
│ (Trigger)    │  │ (Sidebar)    │  │ (Floating)   │
└──────────────┘  └──────────────┘  └──────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
              ┌──────────▼──────────┐
              │   Zustand Store     │
              │   + localStorage    │
              └─────────────────────┘
```

## Sidebar Store

```typescript
// stores/sidebarStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      isOpen: false,
      toggle: () => set((state) => ({ isOpen: !state.isOpen })),
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
    }),
    {
      name: 'chessr-sidebar',  // localStorage key
    }
  )
);
```

## Custom Hook

```typescript
// hooks/useSidebar.ts

import { useSidebarStore } from '../stores/sidebarStore';

export function useSidebar() {
  const { isOpen, toggle, open, close } = useSidebarStore();
  return { isOpen, toggle, open, close };
}
```

## Usage in Components

```typescript
// Any component
import { useSidebar } from '../hooks/useSidebar';

export function MyComponent() {
  const { isOpen, toggle } = useSidebar();

  return (
    <button onClick={toggle}>
      {isOpen ? 'Close' : 'Open'}
    </button>
  );
}
```

## How Persistence Works

1. **Initial load**: Zustand reads from localStorage
2. **State change**: Zustand writes to localStorage
3. **Page navigation**: State is restored from localStorage
4. **Multiple roots**: All roots read from same localStorage key

```typescript
// localStorage structure
{
  "chessr-sidebar": {
    "state": {
      "isOpen": true
    },
    "version": 0
  }
}
```

## Cross-Root Synchronization

Zustand stores are singletons. All React roots using `useSidebarStore` share the same state instance:

```typescript
// Root 1: Trigger component
const { toggle } = useSidebar();
toggle();  // Sets isOpen = true

// Root 2: Sidebar component (same state instance)
const { isOpen } = useSidebar();
// isOpen is already true!
```

## Adding New State

1. Define the interface:
```typescript
interface NewState {
  value: string;
  setValue: (v: string) => void;
}
```

2. Create the store:
```typescript
export const useNewStore = create<NewState>()(
  persist(
    (set) => ({
      value: '',
      setValue: (v) => set({ value: v }),
    }),
    { name: 'chessr-new-state' }
  )
);
```

3. Create a hook (optional but recommended):
```typescript
export function useNewState() {
  return useNewStore();
}
```

## Best Practices

- **Persist only what's needed**: Don't persist computed values
- **Use meaningful keys**: `chessr-sidebar`, `chessr-settings`, etc.
- **Keep stores focused**: One store per feature/domain
- **Use selectors for performance**: `useSidebarStore(state => state.isOpen)`
