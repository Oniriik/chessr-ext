#!/bin/bash
# Script de mise à jour du serveur Docker (à exécuter depuis local)
# Pull les dernières modifications et redémarre le container
# Usage: bash update-server.sh

set -e

# Configuration
SERVER_USER="ubuntu"
SERVER_HOST="135.125.201.246"
APP_DIR="\$HOME/chess-server"
CONTAINER_NAME="chess-stockfish-server"
IMAGE_NAME="chess-stockfish-server"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔄 Mise à jour du serveur Chess Stockfish (Docker)${NC}"
echo "==================================================="

echo -e "\n${YELLOW}📡 Connexion au serveur...${NC}"

ssh "${SERVER_USER}@${SERVER_HOST}" << 'REMOTE_SCRIPT'
set -e

APP_DIR="$HOME/chess-server"
CONTAINER_NAME="chess-stockfish-server"
IMAGE_NAME="chess-stockfish-server"

echo "📥 Pull des dernières modifications..."
cd "$APP_DIR"
git pull

echo "🐳 Build de l'image Docker..."
docker build -t "$IMAGE_NAME" ./server

echo "🔄 Redémarrage du container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker network create chess-network 2>/dev/null || true

docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    --network chess-network \
    --network-alias chess-server \
    -p 3000:3000 \
    -p 3001:3001 \
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

echo -e "\n${GREEN}✨ Serveur mis à jour avec succès!${NC}"
