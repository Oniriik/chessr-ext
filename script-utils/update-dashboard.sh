#!/bin/bash
# Script de mise à jour du dashboard Docker (à exécuter depuis local)
# Pull les dernières modifications et redémarre le container
# Usage: bash update-dashboard.sh

set -e

# Configuration
SERVER_USER="root"
SERVER_HOST="91.99.78.172"
APP_DIR="/opt/chessr/app"
CONTAINER_NAME="chess-dashboard"
IMAGE_NAME="chess-dashboard"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔄 Mise à jour du Dashboard Chess (Docker)${NC}"
echo "============================================"

echo -e "\n${YELLOW}📡 Connexion au serveur...${NC}"

ssh "${SERVER_USER}@${SERVER_HOST}" << 'REMOTE_SCRIPT'
set -e

APP_DIR="/opt/chessr/app"
CONTAINER_NAME="chess-dashboard"
IMAGE_NAME="chess-dashboard"
ENV_FILE="$APP_DIR/.env.dashboard"

echo "📥 Pull des dernières modifications..."
cd "$APP_DIR"
git pull

# Créer/mettre à jour le fichier .env si nécessaire
if [ ! -f "$ENV_FILE" ]; then
    echo "📝 Création du fichier $ENV_FILE..."
    cat > "$ENV_FILE" << 'ENVEOF'
NEXT_PUBLIC_SUPABASE_URL=https://ratngdlkcvyfdmidtenx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJhdG5nZGxrY3Z5ZmRtaWR0ZW54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwODE0OTMsImV4cCI6MjA4NDY1NzQ5M30.ZYXOVkGgIrdymoRFOs5MHP_03UPOt6Mu00ijYL12Bv4
ADMIN_EMAILS=oniriik.dev@gmail.com
ENVEOF
fi

# Charger les variables d'environnement
source "$ENV_FILE"

echo "🐳 Build de l'image Docker..."
docker build \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    --build-arg NEXT_PUBLIC_CHESS_SERVER_URL="wss://engine.chessr.io" \
    -t "$IMAGE_NAME" ./dashboard

echo "🔄 Redémarrage du container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker network create chess-network 2>/dev/null || true

docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --network chess-network \
    -p 3000:3000 \
    -e METRICS_URL="http://chess-engine:3001/metrics" \
    -e ADMIN_EMAILS="$ADMIN_EMAILS" \
    -e DOCKER_CONTAINER_NAME="chess-engine" \
    -v /var/run/docker.sock:/var/run/docker.sock:ro \
    "$IMAGE_NAME"

echo "✅ Container démarré"

echo ""
echo "📊 Statut du container:"
docker ps --filter "name=$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "🧹 Nettoyage des anciennes images..."
docker image prune -f

echo ""
echo "✨ Mise à jour terminée!"
REMOTE_SCRIPT

echo -e "\n${GREEN}✨ Dashboard mis à jour avec succès!${NC}"
