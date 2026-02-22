# State Management

[← Back to summary](./README.md)

## Overview

State is managed with **Zustand** stores. Some are persisted to **localStorage** for cross-navigation persistence.

## Store Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Stores                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  UI State                  Game State                        │
│  ┌──────────────────┐     ┌──────────────────┐              │
│  │ sidebarStore     │     │ gameStore        │              │
│  │ (persisted)      │     │ (runtime)        │              │
│  └──────────────────┘     └──────────────────┘              │
│                                                              │
│  Engine Settings          Analysis Results                   │
│  ┌──────────────────┐     ┌──────────────────┐              │
│  │ engineStore      │     │ suggestionStore  │              │
│  │ (persisted)      │     │ (runtime)        │              │
│  └──────────────────┘     └──────────────────┘              │
│                                                              │
│  ┌──────────────────┐     ┌──────────────────┐              │
│  │ settingsStore    │     │ accuracyStore    │              │
│  │ (persisted)      │     │ (runtime)        │              │
│  └──────────────────┘     └──────────────────┘              │
│                                                              │
│  Connection                Authentication                    │
│  ┌──────────────────┐     ┌──────────────────┐              │
│  │ webSocketStore   │     │ authStore        │              │
│  │ (runtime)        │     │ (persisted)      │              │
│  └──────────────────┘     └──────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Stores Reference

### sidebarStore

Manages sidebar open/close state. **Persisted**.

```typescript
interface SidebarState {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}
```

### gameStore

Tracks the current game state (detected from chess.com DOM).

```typescript
interface GameState {
  isGameStarted: boolean;
  playerColor: 'white' | 'black' | null;
  currentTurn: 'white' | 'black';
  chessInstance: Chess | null;  // chess.js instance

  setGameStarted: (started: boolean) => void;
  setPlayerColor: (color: 'white' | 'black' | null) => void;
  setCurrentTurn: (turn: 'white' | 'black') => void;
  setChessInstance: (chess: Chess | null) => void;
  resetGame: () => void;
}
```

### engineStore

Engine configuration settings. **Persisted**.

```typescript
interface EngineState {
  userElo: number;
  targetEloAuto: boolean;
  targetEloManual: number;
  personality: Personality;  // 'solid' | 'aggressive' | 'tricky' | etc.

  getTargetElo: () => number;
  setUserElo: (elo: number) => void;
  setTargetEloAuto: (auto: boolean) => void;
  setTargetEloManual: (elo: number) => void;
  setPersonality: (p: Personality) => void;
}
```

### suggestionStore

Move suggestions received from the server.

```typescript
interface Suggestion {
  move: string;           // UCI notation (e.g., "e2e4")
  evaluation: number;     // Centipawns
  depth: number;
  winRate: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;  // 'very_reliable' | 'reliable' | etc.
  pv?: string[];          // Principal variation
  mateScore?: number;
}

interface SuggestionState {
  suggestions: Suggestion[];
  positionEval: number | null;
  mateIn: number | null;
  winRate: number | null;
  isLoading: boolean;
  error: string | null;
  suggestedFen: string | null;

  // Selection state for UI
  selectedIndex: number;
  hoveredIndex: number | null;
  showingPvIndex: number | null;  // Which PV is displayed on board

  // Actions
  requestSuggestions: (fen, targetElo, personality, multiPv) => string;
  receiveSuggestions: (requestId, fen, eval, mate, winRate, suggestions) => void;
  clearSuggestions: () => void;
  setSelectedIndex: (index: number) => void;
  setHoveredIndex: (index: number | null) => void;
  setShowingPvIndex: (index: number | null) => void;
  toggleShowingPv: (index: number) => void;
}
```

### accuracyStore

Move accuracy analysis results.

```typescript
interface MoveAnalysis {
  moveNumber: number;
  move: string;           // SAN notation
  classification: 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';
  cpl: number;            // Centipawn loss
  bestMove: string;
  evalAfter: number;
  mateInAfter?: number;
}

interface AccuracyState {
  accuracy: number | null;
  moveCount: { best: number; excellent: number; /* ... */ };
  moves: MoveAnalysis[];
  isLoading: boolean;

  requestAnalysis: (move, fen, playerColor) => string;
  receiveAnalysis: (requestId, analysis) => void;
  clearAccuracy: () => void;
}
```

### settingsStore

User preferences for display. **Persisted**.

```typescript
interface SettingsState {
  numberOfSuggestions: number;      // 1-3
  useSameColorForAllArrows: boolean;
  singleArrowColor: string;
  firstArrowColor: string;
  secondArrowColor: string;
  thirdArrowColor: string;
  showDetailedMoveSuggestion: boolean;

  setNumberOfSuggestions: (n: number) => void;
  // ... setters for each setting
}
```

### webSocketStore

WebSocket connection state.

```typescript
interface WebSocketState {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
}
```

### authStore

Authentication state. **Persisted**.

```typescript
interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;

  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
}
```

## Selectors

Each store exports convenience selectors for better performance:

```typescript
// Instead of subscribing to entire store
const suggestions = useSuggestionStore(state => state.suggestions);

// Use exported selector
const suggestions = useSuggestions();
```

Example selectors from suggestionStore:

```typescript
export const useSuggestions = () =>
  useSuggestionStore((state) => state.suggestions);
export const useIsSuggestionLoading = () =>
  useSuggestionStore((state) => state.isLoading);
export const useShowingPvIndex = () =>
  useSuggestionStore((state) => state.showingPvIndex);
```

## Cross-Root Synchronization

Zustand stores are singletons. All React roots using the same store share the same state instance:

```typescript
// Root 1: Trigger component
const { toggle } = useSidebar();
toggle();  // Sets isOpen = true

// Root 2: Sidebar component (same state instance)
const { isOpen } = useSidebar();
// isOpen is already true!
```

## Best Practices

- **Persist only what's needed**: Settings yes, suggestions no
- **Use meaningful keys**: `chessr-sidebar`, `chessr-settings`, etc.
- **Keep stores focused**: One store per feature/domain
- **Use selectors for performance**: Subscribe only to what you need
- **Reset runtime stores on game end**: Clear suggestions, accuracy, etc.
