# Chessr Extension Documentation

Technical documentation for the Chessr Chrome Extension v2.

## Table of Contents

1. [Architecture](./architecture.md) - System architecture overview
2. [Platforms](./platforms.md) - Multi-platform system (chess.com, lichess)
3. [Mounting](./mounting.md) - Component injection system
4. [Sidebar](./sidebar.md) - Sidebar components
5. [State Management](./state.md) - State management with Zustand
6. [Styling](./styling.md) - CSS isolation with Tailwind
7. [Authentication](./auth.md) - Supabase auth system

## Tech Stack

- **React 18** - UI components
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling (prefix `tw-`)
- **Zustand** - State management
- **shadcn/ui** - UI components
- **Supabase** - Authentication

## Project Structure

```
extension/
├── src/
│   ├── content/
│   │   ├── index.tsx          # Content script entry point
│   │   └── overlay/           # Board overlay system
│   │       ├── OverlayManager.ts   # SVG overlay management
│   │       ├── ArrowRenderer.ts    # Arrow drawing (suggestions, PV)
│   │       └── EvalBar.ts          # Evaluation bar
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── slider.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── tooltip.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── select.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── collapsible.tsx
│   │   │   ├── plan-badge.tsx     # Plan status badge
│   │   │   └── ...
│   │   ├── auth/              # Authentication components
│   │   │   ├── AuthForm.tsx
│   │   │   ├── AuthGuard.tsx
│   │   │   └── index.ts
│   │   └── sidebar/           # Sidebar components
│   │       ├── SidebarContent.tsx     # Main content with tabs
│   │       ├── SidebarMount.tsx       # Trigger + Portal
│   │       ├── SidebarPortal.tsx      # Replaces original sidebar
│   │       ├── SidebarTrigger.tsx     # Styled trigger button
│   │       ├── BaseSidebarTrigger.tsx # Nav sidebar trigger
│   │       ├── FloatingSidebar.tsx    # Floating panel
│   │       ├── GameStatusCard.tsx     # Game info display
│   │       ├── GameStatsCard.tsx      # Accuracy stats
│   │       ├── MoveListDisplay.tsx    # Suggested moves list
│   │       ├── EloSettings.tsx        # Target ELO settings
│   │       ├── PersonalitySelect.tsx  # Engine personality
│   │       ├── OpeningCard.tsx              # Opening info display
│   │       ├── OpeningSuggestionCard.tsx    # Opening move suggestion
│   │       ├── OpeningRepertoireSelector.tsx # Opening repertoire picker
│   │       ├── settings/              # Settings panel
│   │       │   ├── SettingsView.tsx   # Settings tabs container
│   │       │   ├── AccountTab.tsx     # Account settings
│   │       │   ├── GeneralTab.tsx     # Display settings
│   │       │   ├── SuggestionsTab.tsx # Arrow colors settings
│   │       │   └── index.ts
│   │       └── index.ts
│   ├── contexts/              # React contexts
│   │   ├── PlatformContext.tsx       # Platform info context
│   │   └── PortalContainerContext.tsx # Portal container context
│   ├── platforms/
│   │   ├── chesscom/          # chess.com adapter
│   │   ├── lichess/           # lichess adapter
│   │   ├── types.ts           # Shared types
│   │   └── index.ts           # Platform exports
│   ├── stores/                # Zustand stores
│   │   ├── sidebarStore.ts    # Sidebar open/close state
│   │   ├── authStore.ts       # Authentication state + plan
│   │   ├── gameStore.ts       # Game detection & chess.js state
│   │   ├── engineStore.ts     # Engine settings (ELO, personality)
│   │   ├── suggestionStore.ts # Move suggestions from server
│   │   ├── accuracyStore.ts   # Move accuracy analysis
│   │   ├── settingsStore.ts   # User preferences
│   │   ├── openingStore.ts    # Opening book & repertoire
│   │   └── webSocketStore.ts  # WebSocket connection state
│   ├── hooks/                 # React hooks
│   │   ├── useSidebar.ts          # Sidebar state hook
│   │   ├── useGameDetection.ts    # Detect game start/moves
│   │   ├── useSuggestionTrigger.ts # Request suggestions
│   │   ├── useAnalysisTrigger.ts  # Request move analysis
│   │   ├── useArrowRenderer.ts    # Draw arrows on board
│   │   ├── useEvalBar.ts          # Manage eval bar
│   │   ├── useContainerWidth.ts   # Responsive width
│   │   ├── useOpeningTrigger.ts   # Auto-fetch opening data
│   │   ├── useOpeningArrowRenderer.ts # Draw opening arrows
│   │   ├── useOpeningTracker.ts   # Track opening deviations
│   │   └── useAlternativeOpenings.ts  # Alternative opening suggestions
│   ├── lib/
│   │   ├── utils.ts           # Utilities (cn, etc.)
│   │   ├── supabase.ts        # Supabase client
│   │   ├── webSocket.ts       # WebSocket connection
│   │   ├── logger.ts          # Debug logging
│   │   ├── openingBook.ts     # Opening book API
│   │   ├── openingsDatabase.ts # Local openings database
│   │   └── chess/             # Chess utilities
│   │       ├── index.ts       # Exports
│   │       ├── types.ts       # Chess types
│   │       ├── helpers.ts     # Helper functions
│   │       └── moveExtractor.ts # Extract moves from DOM
│   └── styles/
│       └── content.css        # Global styles + theme
├── public/
│   ├── manifest.json          # Chrome extension manifest
│   └── icons/                 # Extension icons
├── .env.local                 # Environment variables (not committed)
└── dist/                      # Build output
```

## Quick Start

```bash
# Install dependencies
cd extension
npm install

# Create .env.local with Supabase credentials
echo "VITE_SUPABASE_URL=https://xxx.supabase.co" > .env.local
echo "VITE_SUPABASE_ANON_KEY=your-anon-key" >> .env.local

# Build
npm run build

# Load in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select the dist/ folder
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
