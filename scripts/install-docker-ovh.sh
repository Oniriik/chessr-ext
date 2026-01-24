#!/bin/bash
# Installation automatique avec Docker sur VPS OVH Ubuntu
# Usage: bash install-docker-ovh.sh

VPS_IP="135.125.201.246"
VPS_USER="ubuntu"
APP_DIR="/home/ubuntu/chess-server"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Installation Chess Server sur OVH   ║${NC}"
echo -e "${BLUE}║            avec Docker                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# 1. Installation de Docker sur le VPS
echo -e "${YELLOW}📦 Installation de Docker...${NC}"
ssh ${VPS_USER}@${VPS_IP} << 'ENDSSH'
# Mise à jour
sudo apt update

# Installation de Docker
curl -fsSL https://get.docker.com | sudo sh

# Ajouter l'utilisateur ubuntu au groupe docker
sudo usermod -aG docker ubuntu

# Installation de Docker Compose
sudo apt install -y docker-compose-plugin

# Vérification
docker --version
docker compose version

echo ""
echo "✅ Docker installé"
ENDSSH

echo -e "${GREEN}✅ Docker installé${NC}"

# Déconnexion/reconnexion pour appliquer les groupes
echo -e "${YELLOW}⚡ Application des permissions Docker...${NC}"
ssh ${VPS_USER}@${VPS_IP} "newgrp docker << END
docker ps
END"

# 2. Transfert des fichiers
echo -e "\n${YELLOW}📤 Transfert des fichiers...${NC}"
ssh ${VPS_USER}@${VPS_IP} "mkdir -p ${APP_DIR}"

rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'extension' \
  server/ docker-compose.yml nginx/ ${VPS_USER}@${VPS_IP}:${APP_DIR}/

echo -e "${GREEN}✅ Fichiers transférés${NC}"

# 3. Build et démarrage
echo -e "\n${YELLOW}🚀 Build et démarrage du serveur...${NC}"
ssh ${VPS_USER}@${VPS_IP} << ENDSSH
cd ${APP_DIR}

# Build de l'image
docker compose build

# Démarrage
docker compose up -d

echo ""
echo "📊 Statut :"
docker compose ps

echo ""
echo "Attente du démarrage (5 secondes)..."
sleep 5

echo ""
echo "📋 Logs :"
docker compose logs --tail=30
ENDSSH

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    ✨ Installation terminée ! ✨       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}🌐 Votre serveur est accessible sur :${NC}"
echo "  ${GREEN}ws://${VPS_IP}:3000${NC}"
echo "  ${GREEN}ws://vps-8058cb7f.vps.ovh.net:3000${NC}"
echo ""
echo -e "${YELLOW}📊 Commandes utiles :${NC}"
echo "  ${BLUE}# Voir les logs${NC}"
echo "  ssh ${VPS_USER}@${VPS_IP} 'cd ${APP_DIR} && docker compose logs -f'"
echo ""
echo "  ${BLUE}# Redémarrer${NC}"
echo "  ssh ${VPS_USER}@${VPS_IP} 'cd ${APP_DIR} && docker compose restart'"
echo ""
echo "  ${BLUE}# Statut${NC}"
echo "  ssh ${VPS_USER}@${VPS_IP} 'cd ${APP_DIR} && docker compose ps'"
echo ""
echo -e "${YELLOW}🧪 Tester la connexion :${NC}"
echo "  wscat -c ws://${VPS_IP}:3000"
echo ""
echo -e "${YELLOW}📝 Pour configurer un domaine avec SSL :${NC}"
echo "  bash scripts/setup-nginx-ovh.sh votre-domaine.com"
