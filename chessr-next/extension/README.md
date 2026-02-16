# Chessr Extension v2

Chrome extension for Chess.com that provides game analysis and coaching features.

## Features

### Game Detection
- Automatic detection when a game starts on Chess.com
- Detects player color and current turn
- Supports routes: `/play/online`, `/play/computer`, `/game/*`

### Chess.js Integration
- Replays moves in parallel using chess.js
- Provides access to:
  - FEN position
  - Legal moves
  - Check/checkmate/stalemate status
  - Captured pieces
  - Material balance

### ELO Settings
- Auto-detection of player and opponent ELO from Chess.com
- Target ELO = User ELO + 150 (auto mode)
- Manual override with sliders
- Persisted settings in localStorage

## Architecture

### Stores (Zustand)
- `gameStore` - Game state, chess.js instance, move history
- `eloStore` - ELO settings with auto-detection
- `authStore` - Supabase authentication
- `sidebarStore` - Sidebar UI state
- `settingsStore` - User preferences (language, display options)
- `webSocketStore` - WebSocket connection state

### WebSocket

- Real-time connection to Chessr server
- Token-based authentication via Supabase
- Auto-disconnect after 2 minutes of inactivity
- Auto-reconnect with exponential backoff (1s, 2s, 4s... up to 16s)
- Inactivity detection based on tab visibility and game state

### Logger

- Centralized logging utility (`lib/logger.ts`)
- All logs prefixed with `[Chessr.io]`
- Methods: `log`, `info`, `warn`, `error`, `debug`

### Platforms
- `chesscom/` - Chess.com specific detection and routes
  - `detectGameStarted()` - Checks for move list
  - `detectPlayerColor()` - Board orientation detection
  - `detectCurrentTurn()` - Active clock detection
  - `detectRatings()` - Player/opponent ELO extraction

### Components

- `EloSettings` - Collapsible ELO configuration panel
- `GameStatusCard` - Current game status display
- `SidebarMount` - Sidebar injection into Chess.com
- `SettingsView` - Settings panel with tabbed navigation
  - `AccountTab` - Email, verification status, billing
  - `GeneralTab` - Language, display preferences

## Environment Variables

Create a `.env.local` file:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_WS_URL=ws://localhost:8080
```

## Development

```bash
cd extension
npm install
npm run dev    # Watch mode
npm run build  # Production build
```

Load the `dist/` folder as an unpacked extension in Chrome.
