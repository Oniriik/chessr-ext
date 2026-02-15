# Styling

[← Back to summary](./README.md)

## Overview

CSS isolation is critical for extensions. We use:

- **Tailwind CSS** with `tw-` prefix
- **CSS Variables** for theming
- **`#chessr-root`** as scope
- **Native classes** for integration with host site

## Tailwind Configuration

```typescript
// tailwind.config.ts

export default {
  prefix: 'tw-',              // All classes prefixed: tw-flex, tw-p-4, etc.
  important: true,            // Override host site styles
  content: ['./src/**/*.{ts,tsx}'],
  corePlugins: {
    preflight: false,         // Don't reset host site styles
  },
  theme: {
    extend: {
      colors: {
        chessr: {
          DEFAULT: 'hsl(217 91% 60%)',
          light: 'hsl(217 91% 70%)',
          dark: 'hsl(217 91% 50%)'
        },
        // shadcn/ui colors via CSS vars
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // ...
      }
    }
  }
}
```

## CSS Variables

```css
/* styles/content.css */

#chessr-root {
  /* Background & Foreground */
  --background: 240 20% 5%;
  --foreground: 240 6% 90%;

  /* Card */
  --card: 233 19% 8%;
  --card-foreground: 240 6% 90%;

  /* Primary - Blue */
  --primary: 217 91% 60%;
  --primary-foreground: 0 0% 100%;

  /* Border & Input */
  --border: 236 20% 20%;
  --input: 236 20% 20%;
  --ring: 217 91% 60%;

  /* Radius */
  --radius: 0.5rem;
}
```

## Mount Wrapper

```css
/* Make wrapper transparent to layout */
.chessr-mount {
  display: contents;
}

/* Match host site hover styles */
.chessr-mount .sidebar-link:hover {
  background: rgba(255, 255, 255, 0.08);
}
```

## Styling Strategies

### 1. Inside #chessr-root (Tailwind)

For Chessr UI components:

```tsx
<div className="tw-bg-card tw-p-4 tw-rounded-lg">
  <h2 className="tw-text-foreground tw-font-bold">Title</h2>
</div>
```

### 2. Host Site Integration (Native Classes)

For components that need to blend with chess.com:

```tsx
// Uses chess.com native classes
<a className="sidebar-link cc-button-component">
  <div className="cc-avatar-component cc-avatar-size-24">
    <img className="cc-avatar-img" src={logo} />
  </div>
  <h2 className="sidebar-link-text cc-text-medium-bold">Chessr</h2>
</a>
```

### 3. Inline Styles (Escape Hatch)

When you need precise control:

```tsx
<div
  style={{
    position: 'fixed',
    right: 0,
    top: 0,
    width: '320px',
    zIndex: 9998,
  }}
>
```

## shadcn/ui Components

shadcn/ui components use the `cn()` utility:

```typescript
// lib/utils.ts

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Components automatically get the `tw-` prefix through Tailwind:

```tsx
// components/ui/button.tsx
<button className={cn(
  "tw-inline-flex tw-items-center tw-justify-center",
  "tw-bg-primary tw-text-primary-foreground",
  className
)} />
```

## Best Practices

### DO:
- Use `tw-` prefix for all Tailwind classes
- Scope custom CSS to `#chessr-root` or `.chessr-mount`
- Use CSS variables for theming
- Use native classes when blending with host site

### DON'T:
- Use Tailwind preflight (resets host styles)
- Use global CSS without scoping
- Assume class names won't conflict
- Use `!important` everywhere (use selector specificity)

## Debugging Styles

1. **Inspect element** in DevTools
2. Check if classes have `tw-` prefix
3. Check if styles are scoped to `#chessr-root`
4. Check for specificity conflicts with host site
