#!/bin/bash
# Script de mise à jour du serveur Docker (à exécuter depuis local)
# Pull les dernières modifications et redémarre les containers avec docker compose
# Usage: bash update-server.sh

set -e

# Configuration
SERVER_USER="root"
SERVER_HOST="91.99.78.172"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔄 Mise à jour du serveur Chess Engine (Docker Compose)${NC}"
echo "==========================================================="

echo -e "\n${YELLOW}📡 Connexion au serveur...${NC}"

ssh "${SERVER_USER}@${SERVER_HOST}" << 'REMOTE_SCRIPT'
set -e

APP_DIR="/opt/chessr/app"

echo "📥 Pull des dernières modifications..."
cd "$APP_DIR"
git pull

echo "🛑 Arrêt des containers existants..."
docker stop chess-engine chess-dashboard 2>/dev/null || true
docker rm chess-engine chess-dashboard 2>/dev/null || true

echo "🐳 Rebuild et redémarrage avec docker compose..."
docker compose up -d --build

echo "✅ Containers démarrés"

echo ""
echo "📊 Statut des containers:"
docker compose ps

echo ""
echo "🔍 Vérification des variables d'environnement Grafana..."
if docker exec chess-engine env | grep -q GRAFANA_INSTANCE_ID; then
    echo "✅ Variables Grafana présentes"
else
    echo "⚠️  Variables Grafana manquantes!"
fi

echo ""
echo "🧹 Nettoyage des anciennes images..."
docker image prune -f

echo ""
echo "🔍 Test de santé des services..."
sleep 3

# Test WebSocket server
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "426"; then
    echo "✅ WebSocket server (port 3000) OK"
else
    echo "⚠️  WebSocket server (port 3000) ne répond pas!"
fi

# Test Dashboard
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3002 | grep -q "200"; then
    echo "✅ Dashboard (port 3002) OK"
else
    echo "⚠️  Dashboard (port 3002) ne répond pas!"
fi

# Test public endpoints via nginx
if curl -s -o /dev/null -w "%{http_code}" https://engine.chessr.io 2>/dev/null | grep -q "426"; then
    echo "✅ engine.chessr.io OK"
else
    echo "⚠️  engine.chessr.io ne répond pas (vérifier nginx)"
fi

if curl -s -o /dev/null -w "%{http_code}" https://dashboard.chessr.io 2>/dev/null | grep -q "200"; then
    echo "✅ dashboard.chessr.io OK"
else
    echo "⚠️  dashboard.chessr.io ne répond pas (vérifier nginx)"
fi

echo ""
echo "✨ Mise à jour terminée!"
REMOTE_SCRIPT

echo -e "\n${GREEN}✨ Serveur mis à jour avec succès!${NC}"
