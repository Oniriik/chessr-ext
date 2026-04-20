# Chessr v3 — Admin Dashboard (beta)

Minimal admin dashboard for the v3 stack.

## Scope (v0)

- Email/password login via Supabase
- Access gate: only users with `user_settings.role` in `('admin', 'super_admin')`
- Live server-log viewer (SSE stream from `/admin/logs/stream` on the serveur)

## Local dev

```bash
cp .env.local.example .env.local
# fill the four values — anon key from Supabase, SERVEUR_ADMIN_TOKEN from serveur/.env.beta
npm install
npm run dev   # port 3002
```

Open http://localhost:3002 → redirects to `/login` → sign in with an admin account.

## Env vars

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key for user auth |
| `SUPABASE_SERVICE_KEY` | Service-role key, server-only (reads `user_settings.role`) |
| `NEXT_PUBLIC_SERVEUR_URL` | v3 serveur base URL, e.g. `https://beta.chessr.io` |
| `SERVEUR_ADMIN_TOKEN` | Shared secret with the serveur (must match `ADMIN_TOKEN` in serveur/.env) |

## Architecture

```
Browser
  │ (SSE) GET /api/logs/stream    (verifies Supabase session + admin role)
  ▼
Next.js API route
  │ (SSE) GET /admin/logs/stream  (sends X-Admin-Token header)
  ▼
v3 serveur   (hooks console.log via logBuffer → fans out to SSE subscribers)
```
