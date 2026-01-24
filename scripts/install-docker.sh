#!/bin/bash
# Installation automatique avec Docker
# Usage: bash install-docker.sh

VPS_IP="135.125.201.246"
APP_DIR="/opt/chess-server"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🐳 Installation Docker sur VPS${NC}"
echo "==============================="

# 1. Installation de Docker sur le VPS
echo -e "\n${YELLOW}📦 Installation de Docker...${NC}"
ssh root@${VPS_IP} << 'ENDSSH'
# Mise à jour
apt update

# Installation de Docker
curl -fsSL https://get.docker.com | sh

# Installation de Docker Compose
apt install -y docker-compose-plugin

# Vérification
docker --version
docker compose version
ENDSSH

echo -e "${GREEN}✅ Docker installé${NC}"

# 2. Transfert des fichiers
echo -e "\n${YELLOW}📤 Transfert des fichiers...${NC}"
ssh root@${VPS_IP} "mkdir -p ${APP_DIR}"

rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'extension' \
  server/ docker-compose.yml nginx/ root@${VPS_IP}:${APP_DIR}/

echo -e "${GREEN}✅ Fichiers transférés${NC}"

# 3. Build et démarrage
echo -e "\n${YELLOW}🚀 Démarrage du serveur...${NC}"
ssh root@${VPS_IP} << ENDSSH
cd ${APP_DIR}

# Build de l'image
docker compose build

# Démarrage
docker compose up -d

# Afficher les logs
echo ""
echo "📊 Statut :"
docker compose ps

echo ""
echo "📋 Logs (Ctrl+C pour quitter) :"
sleep 2
docker compose logs --tail=50
ENDSSH

echo ""
echo -e "${GREEN}✨ Installation terminée !${NC}"
echo ""
echo -e "${YELLOW}Votre serveur est accessible sur :${NC}"
echo "  ws://${VPS_IP}:3000"
echo ""
echo -e "${YELLOW}Commandes utiles :${NC}"
echo "  ssh root@${VPS_IP} 'cd ${APP_DIR} && docker compose logs -f'"
echo "  ssh root@${VPS_IP} 'cd ${APP_DIR} && docker compose restart'"
echo ""
echo -e "${YELLOW}Tester la connexion :${NC}"
echo "  wscat -c ws://${VPS_IP}:3000"
