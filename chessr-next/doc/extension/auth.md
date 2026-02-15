# Authentication

[← Back to summary](./README.md)

## Overview

Authentication is handled via **Supabase** with session persistence in `chrome.storage.local`.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Extension                         │
│  ┌───────────────┐      ┌───────────────────────┐  │
│  │ Supabase Auth │      │ WebSocket Client      │  │
│  │ (login/signup)│      │ (sends JWT)           │  │
│  └───────┬───────┘      └───────────┬───────────┘  │
│          │                          │               │
│          ▼                          │               │
│  ┌───────────────┐                  │               │
│  │chrome.storage │──────────────────┘               │
│  │ (JWT token)   │                                  │
│  └───────────────┘                                  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼ JWT
┌─────────────────────────────────────────────────────┐
│                    Server                           │
│  ┌───────────────┐      ┌───────────────────────┐  │
│  │ JWT Verify    │ ───▶ │ Authorize analysis    │  │
│  └───────────────┘      └───────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Files

```
src/
├── lib/
│   └── supabase.ts           # Supabase client with chrome.storage adapter
├── stores/
│   └── authStore.ts          # Zustand store for auth state
└── components/
    └── auth/
        ├── AuthForm.tsx      # Login/signup/reset form
        ├── AuthGuard.tsx     # Conditional wrapper
        └── index.ts          # Exports
```

## Supabase Client

The client uses a custom storage adapter for Chrome extensions:

```typescript
// lib/supabase.ts
const chromeStorageAdapter = {
  getItem: (key) => chrome.storage.local.get(key),
  setItem: (key, value) => chrome.storage.local.set({ [key]: value }),
  removeItem: (key) => chrome.storage.local.remove(key),
};

export const supabase = createClient(URL, ANON_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    storageKey: 'chessr-auth',
    detectSessionInUrl: false, // Important for extensions
  },
});
```

## Auth Store

```typescript
// stores/authStore.ts
interface AuthState {
  user: User | null;
  session: Session | null;
  initializing: boolean;
  loading: boolean;
  error: string | null;

  initialize: () => Promise<void>;
  signIn: (email, password) => Promise<Result>;
  signUp: (email, password) => Promise<Result>;
  signOut: () => Promise<void>;
  resetPassword: (email) => Promise<Result>;
  resendConfirmationEmail: (email) => Promise<Result>;
  clearError: () => void;
}
```

## AuthGuard Component

Wraps content to show login form or authenticated content:

```typescript
// components/auth/AuthGuard.tsx
export function AuthGuard({ children }) {
  const { user, initializing, initialize } = useAuthStore();

  useEffect(() => { initialize(); }, []);

  if (initializing) return <Loader />;
  if (!user) return <AuthForm />;
  return <>{children}</>;
}
```

## AuthForm Component

Single form with 3 modes:
- **login** - Email + password
- **signup** - Email + password + confirm password
- **reset** - Email only

Features:
- Client-side validation (password min 6 chars, password match)
- Email confirmation flow
- Error/success states
- Resend confirmation email

## Usage

```typescript
// In SidebarContent.tsx
import { AuthGuard } from '../auth';

export function SidebarContent() {
  return (
    <AuthGuard>
      <AuthenticatedContent />
    </AuthGuard>
  );
}
```

## Environment Variables

```bash
# .env.local
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

## UI Components Used

- `Button` - Submit, links (variant: default, link)
- `Card` - Form container
- `Input` - Email, password fields
- `Label` - Field labels
