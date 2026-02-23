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
│  Opening Book                                                │
│  ┌──────────────────┐                                       │
│  │ openingStore     │                                       │
│  │ (partial persist)│                                       │
│  └──────────────────┘                                       │
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

Tracks the current game state (detected from chess.com DOM). Includes chess.js instance for move validation and state computation.

```typescript
interface GameState {
  // Core state
  isGameStarted: boolean;
  playerColor: 'white' | 'black' | null;
  currentTurn: 'white' | 'black';

  // Chess.js state
  chessInstance: Chess | null;
  moveHistory: string[];  // SAN moves

  // Basic setters
  setGameStarted: (started: boolean) => void;
  setPlayerColor: (color: 'white' | 'black' | null) => void;
  setCurrentTurn: (turn: 'white' | 'black') => void;

  // Chess actions
  syncFromDOM: () => void;  // Sync chess.js from DOM move list
  reset: () => void;

  // Computed selectors
  getChessState: () => ChessState | null;
  getUciMoves: () => string[];  // UCI format (e2e4, g1f3, etc.)
}
```

Convenience selectors:

```typescript
export const useChessState = () => useGameStore((state) => state.getChessState());
export const useFEN = () => useGameStore((state) => state.chessInstance?.fen() ?? null);
export const useIsCheck = () => useGameStore((state) => state.chessInstance?.isCheck() ?? false);
export const useLegalMoves = () => useGameStore((state) => state.chessInstance?.moves({ verbose: true }) ?? []);
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
type EvalBarMode = 'eval' | 'winrate';

interface SettingsState {
  // Language
  language: string;

  // Display settings
  showGameStatistics: boolean;
  showDetailedMoveSuggestion: boolean;
  showEvalBar: boolean;
  evalBarMode: EvalBarMode;

  // Arrow settings
  numberOfSuggestions: 1 | 2 | 3;
  useSameColorForAllArrows: boolean;
  singleArrowColor: string;
  firstArrowColor: string;
  secondArrowColor: string;
  thirdArrowColor: string;

  // Actions
  setLanguage: (language: string) => void;
  setShowGameStatistics: (show: boolean) => void;
  setShowDetailedMoveSuggestion: (show: boolean) => void;
  setShowEvalBar: (show: boolean) => void;
  setEvalBarMode: (mode: EvalBarMode) => void;
  setNumberOfSuggestions: (num: 1 | 2 | 3) => void;
  // ... setters for arrow colors
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

Authentication state with plan management. **Persisted via chrome.storage**.

```typescript
type Plan = 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime';

interface AuthState {
  // User state
  user: User | null;
  session: Session | null;
  plan: Plan;
  planExpiry: Date | null;
  initializing: boolean;  // true only during initial auth check
  loading: boolean;       // true during actions (login, signup, etc.)
  error: string | null;

  // Actions
  initialize: () => Promise<void>;
  fetchPlan: (userId: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<Result>;
  signIn: (email: string, password: string) => Promise<Result>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<Result>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<Result>;
  resendConfirmationEmail: (email: string) => Promise<Result>;
  clearError: () => void;
}
```

Plan is fetched from `user_settings` table in Supabase after successful login.

### openingStore

Manages opening book state and user's opening repertoire. **Partially persisted** (repertoire and settings only).

```typescript
interface SavedOpening {
  name: string;
  moves: string;  // SAN format: "1. e4 e5 2. Nf3 Nc6"
  eco: string;
  totalGames: number;
}

interface OpeningRepertoire {
  white: SavedOpening | null;
  black: SavedOpening | null;
}

interface OpeningState {
  // Current position info (runtime)
  isInBook: boolean;
  openingName: string | null;
  eco: string | null;
  bookMoves: BookMove[];
  totalGames: number;

  // Tracking
  leftBookAtMove: number | null;
  previousOpeningName: string | null;
  deviationDetected: boolean;
  deviationMove: string | null;

  // Loading state
  isLoading: boolean;
  error: string | null;

  // User repertoire (persisted)
  repertoire: OpeningRepertoire;

  // Settings (persisted)
  showOpeningArrows: boolean;
  showOpeningCard: boolean;
  openingArrowColor: string;

  // Actions
  setOpeningData: (data: { opening, moves, isInBook, totalGames }) => void;
  markOutOfBook: (moveNumber: number) => void;
  setDeviation: (move: string | null) => void;
  reset: () => void;
  setWhiteOpening: (opening: SavedOpening | null) => void;
  setBlackOpening: (opening: SavedOpening | null) => void;
  clearRepertoire: () => void;
  setShowOpeningArrows: (show: boolean) => void;
  setShowOpeningCard: (show: boolean) => void;
  setOpeningArrowColor: (color: string) => void;
}
```

Convenience selectors:

```typescript
export const useIsInBook = () => useOpeningStore((state) => state.isInBook);
export const useOpeningName = () => useOpeningStore((state) => state.openingName);
export const useBookMoves = () => useOpeningStore((state) => state.bookMoves);
export const useRepertoire = () => useOpeningStore((state) => state.repertoire);
export const useShowOpeningArrows = () => useOpeningStore((state) => state.showOpeningArrows);
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
