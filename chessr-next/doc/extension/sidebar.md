# Sidebar Components

[← Back to summary](./README.md)

## Overview

The sidebar system has multiple components for different scenarios:

```
components/sidebar/
├── SidebarContent.tsx      # Main sidebar content (shared)
├── SidebarMount.tsx        # Trigger + Portal (replaces original sidebar)
├── SidebarPortal.tsx       # Portal that replaces original sidebar
├── SidebarTrigger.tsx      # Standalone trigger button (styled)
├── BaseSidebarTrigger.tsx  # Trigger in chess.com navigation sidebar
└── FloatingSidebar.tsx     # Floating sidebar panel (right side)
```

## Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    Sidebar System                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌─────────────────────┐        │
│  │  BaseSidebarTrigger │    │  SidebarMount       │        │
│  │  (nav sidebar)      │    │  ├── SidebarTrigger │        │
│  └─────────────────────┘    │  └── SidebarPortal  │        │
│           │                 │       └── SidebarContent     │
│           │                 └─────────────────────┘        │
│           │                                                 │
│           ▼                                                 │
│  ┌─────────────────────┐                                   │
│  │  FloatingSidebar    │  (when no dedicated sidebar)      │
│  │  └── SidebarContent │                                   │
│  └─────────────────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## BaseSidebarTrigger

Button in the chess.com navigation sidebar (left side). Uses native chess.com classes for seamless integration.

```typescript
// components/sidebar/BaseSidebarTrigger.tsx

export function BaseSidebarTrigger() {
  const { isOpen, toggle } = useSidebar();
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  return (
    <a
      onClick={(e) => { e.preventDefault(); toggle(); }}
      href="#"
      className="sidebar-link cc-button-component"  // Native chess.com classes
    >
      <div className="cc-avatar-component cc-avatar-size-24">
        <img className="cc-avatar-img" src={logoUrl} height="24" width="24" />
      </div>
      <h2 className="sidebar-link-text cc-text-medium-bold">Chessr</h2>
      {isOpen && <span className="indicator-dot" />}
    </a>
  );
}
```

## SidebarMount

Combined trigger + portal for pages with a dedicated sidebar to replace.

```typescript
// components/sidebar/SidebarMount.tsx

interface SidebarMountProps {
  originalSidebarSelector: string;  // Selector of sidebar to replace
  inheritClass?: string;            // Class to inherit for styling
}

export function SidebarMount({ originalSidebarSelector, inheritClass }: SidebarMountProps) {
  return (
    <>
      <SidebarTrigger />
      <SidebarPortal
        originalSidebarSelector={originalSidebarSelector}
        inheritClass={inheritClass}
      />
    </>
  );
}
```

## SidebarPortal

Creates a portal that replaces the original sidebar.

```typescript
// components/sidebar/SidebarPortal.tsx

export function SidebarPortal({ originalSidebarSelector, inheritClass }) {
  const { isOpen } = useSidebar();

  useEffect(() => {
    const originalSidebar = document.querySelector(originalSidebarSelector);
    let chessrSidebar = document.getElementById('chessr-sidebar');

    // Create sidebar container if needed
    if (!chessrSidebar) {
      chessrSidebar = document.createElement('div');
      chessrSidebar.id = 'chessr-sidebar';
    }

    // Toggle visibility
    if (isOpen) {
      originalSidebar.style.display = 'none';
      chessrSidebar.style.display = 'block';
    } else {
      originalSidebar.style.display = '';
      chessrSidebar.style.display = 'none';
    }
  }, [isOpen]);

  return createPortal(<SidebarContent />, container);
}
```

## FloatingSidebar

Floating panel on the right side for pages without a dedicated sidebar.

```typescript
// components/sidebar/FloatingSidebar.tsx

export function FloatingSidebar() {
  const { isOpen, toggle } = useSidebar();

  return (
    <div
      className="tw-fixed tw-top-0 tw-right-0 tw-h-full tw-z-[9998]"
      style={{
        width: '320px',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
      }}
    >
      <div id="chessr-root" className="tw-h-full tw-bg-[hsl(233,19%,8%)]">
        {/* Header with close button */}
        <div className="header">
          <img src={logoUrl} />
          <span>Chessr</span>
          <button onClick={toggle}>✕</button>
        </div>

        {/* Content */}
        <SidebarContent />
      </div>
    </div>
  );
}
```

## SidebarContent

The actual content shared between all sidebar variants.

```typescript
// components/sidebar/SidebarContent.tsx

export function SidebarContent() {
  return (
    <div className="tw-p-4">
      {/* Analysis widgets */}
      {/* Settings */}
      {/* etc. */}
    </div>
  );
}
```

## When to Use Each

| Route | Trigger | Sidebar |
|-------|---------|---------|
| `home` | BaseSidebarTrigger | FloatingSidebar |
| `play-computer` | BaseSidebarTrigger + SidebarTrigger | SidebarPortal (replaces original) |
| `play-online` | BaseSidebarTrigger + SidebarTrigger | SidebarPortal (replaces original) |
| `analysis` | BaseSidebarTrigger | FloatingSidebar |
| `game` | BaseSidebarTrigger | FloatingSidebar |
| `unknown` | BaseSidebarTrigger | FloatingSidebar |
