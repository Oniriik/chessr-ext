#!/bin/bash
# Script de mise à jour du dashboard Docker (à exécuter depuis local)
# Pull les dernières modifications et redémarre le container via docker compose
# Usage: bash update-dashboard.sh

set -e

# Configuration
SERVER_USER="root"
SERVER_HOST="91.99.78.172"
APP_DIR="/opt/chessr/app"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🔄 Mise à jour du Dashboard Chess (Docker Compose)${NC}"
echo "==================================================="

echo -e "\n${YELLOW}📡 Connexion au serveur...${NC}"

ssh "${SERVER_USER}@${SERVER_HOST}" << 'REMOTE_SCRIPT'
set -e

APP_DIR="/opt/chessr/app"

echo "📥 Pull des dernières modifications..."
cd "$APP_DIR"
git pull

# Vérifier que le fichier .env existe
if [ ! -f "$APP_DIR/.env" ]; then
    echo "❌ Erreur: fichier .env manquant dans $APP_DIR"
    exit 1
fi

echo "🐳 Rebuild du dashboard avec docker compose..."
docker compose build dashboard

echo "🔄 Redémarrage du container dashboard..."
docker compose up -d dashboard

echo "✅ Container démarré"

echo ""
echo "📊 Statut du container:"
docker compose ps | grep dashboard

echo ""
echo "🔍 Test de santé du dashboard..."
sleep 2

# Test Dashboard local
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200"; then
    echo "✅ Dashboard (port 3000) OK"
else
    echo "⚠️  Dashboard (port 3000) ne répond pas!"
fi

# Test public endpoint via nginx
if curl -s -o /dev/null -w "%{http_code}" https://dashboard.chessr.io 2>/dev/null | grep -q "200"; then
    echo "✅ dashboard.chessr.io OK"
else
    echo "⚠️  dashboard.chessr.io ne répond pas (vérifier nginx)"
fi

echo ""
echo "🧹 Nettoyage des anciennes images..."
docker image prune -f

echo ""
echo "✨ Mise à jour terminée!"
REMOTE_SCRIPT

echo -e "\n${GREEN}✨ Dashboard mis à jour avec succès!${NC}"
