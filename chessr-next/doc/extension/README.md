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
│   │   └── index.tsx          # Content script entry point
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   └── dropdown-menu.tsx
│   │   ├── auth/              # Authentication components
│   │   │   ├── AuthForm.tsx
│   │   │   ├── AuthGuard.tsx
│   │   │   └── index.ts
│   │   └── sidebar/           # Sidebar components
│   ├── platforms/
│   │   ├── chesscom/          # chess.com adapter
│   │   ├── lichess/           # lichess adapter
│   │   ├── types.ts           # Shared types
│   │   └── index.ts           # Platform exports
│   ├── stores/                # Zustand stores
│   │   ├── sidebarStore.ts
│   │   └── authStore.ts
│   ├── hooks/                 # React hooks
│   ├── contexts/              # React contexts
│   ├── lib/
│   │   ├── utils.ts           # Utilities (cn, etc.)
│   │   └── supabase.ts        # Supabase client
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
