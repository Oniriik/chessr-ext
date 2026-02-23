# Sidebar Components

[← Back to summary](./README.md)

## Overview

The sidebar system has multiple components for different scenarios:

```
components/sidebar/
├── SidebarContent.tsx      # Main sidebar content (tabs, widgets, settings toggle)
├── SidebarMount.tsx        # Trigger + Portal (replaces original sidebar)
├── SidebarPortal.tsx       # Portal that replaces original sidebar
├── SidebarTrigger.tsx      # Standalone trigger button (styled)
├── BaseSidebarTrigger.tsx  # Trigger in chess.com navigation sidebar
├── FloatingSidebar.tsx     # Floating sidebar panel (right side)
├── GameStatusCard.tsx      # Game info (color, turn, status)
├── GameStatsCard.tsx       # Accuracy statistics
├── MoveListDisplay.tsx     # Suggested moves with PV preview
├── EloSettings.tsx         # Target ELO configuration
├── PersonalitySelect.tsx   # Engine personality selector
├── OpeningCard.tsx         # Current opening info display
├── OpeningSuggestionCard.tsx    # Opening move suggestion card
├── OpeningRepertoireSelector.tsx # Opening repertoire picker
├── settings/               # Settings panel
│   ├── SettingsView.tsx    # Settings tabs container
│   ├── AccountTab.tsx      # Account & password settings
│   ├── GeneralTab.tsx      # Display settings (language, eval bar)
│   ├── SuggestionsTab.tsx  # Arrow colors settings
│   └── index.ts
└── index.ts
```

## Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    Sidebar System                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐    ┌─────────────────────┐         │
│  │  BaseSidebarTrigger │    │  SidebarMount       │         │
│  │  (nav sidebar)      │    │  ├── SidebarTrigger │         │
│  └─────────────────────┘    │  └── SidebarPortal  │         │
│           │                 │       └── SidebarContent      │
│           │                 └─────────────────────┘         │
│           │                                                  │
│           ▼                                                  │
│  ┌─────────────────────┐                                    │
│  │  FloatingSidebar    │  (when no dedicated sidebar)       │
│  │  └── SidebarContent │                                    │
│  └─────────────────────┘                                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## SidebarContent

The main content with header, settings toggle, and tabs for different features.

```typescript
// Structure
<Card>
  <SidebarHeader />  {/* Logo, PlanBadge, settings button, logout, close */}

  {showSettings ? (
    <SettingsView />  {/* Account, General, Suggestions tabs */}
  ) : (
    <>
      <GameStatusCard />
      <Tabs defaultValue="game">
        <TabsList>
          <TabsTrigger value="game">Game Infos</TabsTrigger>
          <TabsTrigger value="engine">Engine</TabsTrigger>
        </TabsList>

        <TabsContent value="game">
          <GameStatsCard />
          <MoveListDisplay />
        </TabsContent>

        <TabsContent value="engine">
          <EloSettings />
          <OpeningRepertoireSelector />
        </TabsContent>
      </Tabs>
    </>
  )}
</Card>
```

### SidebarHeader

Header with responsive layout:
- Logo + "Chessr.io" title
- Settings button (gear icon)
- PlanBadge (compact mode when width < 350px)
- Logout button
- Close button

## Game Tab Components

### GameStatusCard

Displays current game information:
- Player color (White/Black)
- Current turn
- Refresh button to re-detect game

### GameStatsCard

Displays accuracy statistics during the game:
- Overall accuracy percentage
- Move classification counts (Best, Excellent, Good, Inaccuracies, Mistakes, Blunders)

### MoveListDisplay

Displays suggested moves from the engine:
- Move notation with UCI format
- Quality badges (Best, Safe, OK, Risky)
- Effect badges (Check, Mate, Capture, Promotion)
- Evaluation score (in pawns, from player's perspective)
- PV (Principal Variation) preview
- Eye button to show PV arrows on board

```typescript
interface SuggestionCard {
  suggestion: Suggestion;
  rank: number;           // 1, 2, 3
  isSelected: boolean;
  isShowingPv: boolean;
  flags: MoveFlags;       // isCheck, isMate, isCapture, isPromotion

  onSelect: () => void;
  onHoverStart: () => void;
  onHoverEnd: () => void;
  onTogglePv: () => void;
  onPvHoverStart: () => void;
  onPvHoverEnd: () => void;
}
```

**PV Preview Feature:**
- Hover on eye button: Preview PV arrows on board
- Click eye button: Lock PV display
- Leave eye button: Hide preview (unless locked)
- Click again: Unlock and hide

## Engine Tab Components

### EloSettings

Configure target ELO for suggestions:

- Auto mode: Based on user's current rating
- Manual mode: Slider from 400 to 3500
- Checkbox to toggle between modes

### PersonalitySelect

Select engine playing style:

- Solid (positional, safe moves)
- Aggressive (tactical, attacking)
- Tricky (complex positions)
- etc.

### OpeningRepertoireSelector

Select and manage opening repertoire for White and Black:

- Display current selections (White/Black openings)
- Search by name, ECO code, or first move (e4, d4, etc.)
- Color filter buttons (W/B)
- Counter mode: find best responses to White openings
- Winrate bar with stats (White wins, Draw, Black wins)
- Move chips showing the opening moves

Features:
- Popular openings displayed by default
- Search integrates with Lichess API for winrates
- Sort by relevant winrate based on context

## Settings Panel

The settings panel is accessible via the gear icon in the header.

### SettingsView

Container with 3 tabs:

```typescript
<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="general">General</TabsTrigger>
    <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
  </TabsList>
  <TabsContent value="account"><AccountTab /></TabsContent>
  <TabsContent value="general"><GeneralTab /></TabsContent>
  <TabsContent value="suggestions"><SuggestionsTab /></TabsContent>
</Tabs>
```

### AccountTab

- Email display
- Change password form

### GeneralTab

- Language selector (English, more coming soon)
- Show move labels on board (toggle)
- Show Eval bar (toggle + mode selector: Eval/Win%)

### SuggestionsTab

- Number of suggestions (1-3)
- Use same color for all arrows (toggle)
- Arrow color pickers (single or per-rank)

## Opening Components

### OpeningCard

Displays current opening information during game:

- ECO code badge
- Opening name
- Total games played in this position

### OpeningSuggestionCard

Displays a suggested opening move with:

- Move in SAN notation
- Popularity percentage
- Winrate bar

## Mount Components

### BaseSidebarTrigger

Button in the chess.com navigation sidebar (left side). Uses native chess.com classes for seamless integration.

```typescript
export function BaseSidebarTrigger() {
  const { isOpen, toggle } = useSidebar();
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  return (
    <a onClick={toggle} className="sidebar-link cc-button-component">
      <img src={logoUrl} />
      <h2>Chessr</h2>
      {isOpen && <span className="indicator-dot" />}
    </a>
  );
}
```

### SidebarMount

Combined trigger + portal for pages with a dedicated sidebar to replace.

```typescript
interface SidebarMountProps {
  originalSidebarSelector: string;
  inheritClass?: string;
}

export function SidebarMount({ originalSidebarSelector, inheritClass }) {
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

### SidebarPortal

Creates a portal that replaces the original sidebar by toggling visibility.

### FloatingSidebar

Floating panel on the right side for pages without a dedicated sidebar.

```typescript
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
      {/* Header with close button */}
      <SidebarContent />
    </div>
  );
}
```

## When to Use Each

| Route | Trigger | Sidebar |
|-------|---------|---------|
| `home` | BaseSidebarTrigger | FloatingSidebar |
| `play-computer` | BaseSidebarTrigger + SidebarTrigger | SidebarPortal |
| `play-online` | BaseSidebarTrigger + SidebarTrigger | SidebarPortal |
| `analysis` | BaseSidebarTrigger | FloatingSidebar |
| `game` | BaseSidebarTrigger | FloatingSidebar |
| `unknown` | BaseSidebarTrigger | FloatingSidebar |
