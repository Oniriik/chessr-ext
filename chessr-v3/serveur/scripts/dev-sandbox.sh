#!/usr/bin/env bash
# Démarre le serveur dev avec les overrides Paddle sandbox (.env.sandbox).
# dotenv n'écrase pas les vars déjà exportées → seules les vars Paddle
# changent, le reste vient de .env comme d'habitude.
set -euo pipefail
cd "$(dirname "$0")/.."

if grep -q "REMPLACER_" .env.sandbox; then
  echo "⚠️  .env.sandbox contient encore des placeholders REMPLACER_ — complète-le d'abord." >&2
  exit 1
fi

# Redis local requis par BullMQ (127.0.0.1:6379). Démarre un conteneur si absent.
if ! (exec 3<>/dev/tcp/127.0.0.1/6379) 2>/dev/null; then
  echo "[dev-sandbox] Redis absent — docker run redis…"
  docker run -d --name chessr-dev-redis -p 6379:6379 redis:7-alpine >/dev/null
fi

set -a
source .env.sandbox
set +a

exec npm run dev
