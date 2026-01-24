#!/bin/bash
# Installation complète classique (Node.js + PM2)
# Usage: bash full-install.sh

VPS_IP="135.125.201.246"
APP_DIR="/opt/chess-server"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}⚙️  Installation Classique sur VPS${NC}"
echo "==================================="

# 1. Installation des dépendances sur le VPS
echo -e "\n${YELLOW}📦 Installation des prérequis...${NC}"
ssh root@${VPS_IP} << 'ENDSSH'
# Mise à jour
apt update && apt upgrade -y

# Installation Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Installation Stockfish
apt install -y stockfish

# Installation PM2
npm install -g pm2

# Firewall
apt install -y ufw
ufw --force enable
ufw allow ssh
ufw allow 3000/tcp

echo ""
echo "✅ Versions installées :"
node --version
npm --version
stockfish --version | head -1
pm2 --version
ENDSSH

echo -e "${GREEN}✅ Prérequis installés${NC}"

# 2. Transfert des fichiers
echo -e "\n${YELLOW}📤 Transfert des fichiers...${NC}"
ssh root@${VPS_IP} "mkdir -p ${APP_DIR}"

rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'extension' \
  --exclude 'docker-compose.yml' \
  --exclude 'Dockerfile' \
  server/ scripts/ root@${VPS_IP}:${APP_DIR}/

echo -e "${GREEN}✅ Fichiers transférés${NC}"

# 3. Installation et démarrage
echo -e "\n${YELLOW}🚀 Installation de l'application...${NC}"
ssh root@${VPS_IP} << ENDSSH
cd ${APP_DIR}

# Installation des dépendances
npm install

# Build
npm run build

# Démarrage avec PM2
pm2 start dist/index.js --name chess-stockfish-server

# Sauvegarder la config PM2
pm2 save

# Configuration du démarrage automatique
pm2 startup systemd -u root --hp /root

echo ""
echo "📊 Statut PM2 :"
pm2 status

echo ""
echo "📋 Logs :"
pm2 logs chess-stockfish-server --lines 20 --nostream
ENDSSH

echo ""
echo -e "${GREEN}✨ Installation terminée !${NC}"
echo ""
echo -e "${YELLOW}Votre serveur est accessible sur :${NC}"
echo "  ws://${VPS_IP}:3000"
echo ""
echo -e "${YELLOW}Commandes utiles :${NC}"
echo "  ssh root@${VPS_IP} 'pm2 logs chess-stockfish-server'"
echo "  ssh root@${VPS_IP} 'pm2 restart chess-stockfish-server'"
echo "  ssh root@${VPS_IP} 'pm2 monit'"
echo ""
echo -e "${YELLOW}Tester la connexion :${NC}"
echo "  wscat -c ws://${VPS_IP}:3000"
