#!/bin/bash
# Script d'installation automatique pour VPS Ubuntu/Debian
# Usage: bash install-vps.sh

set -e

echo "🚀 Installation du serveur Chess Stockfish sur VPS"
echo "=================================================="

# Couleurs pour les messages
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Vérification root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ Ce script doit être exécuté en tant que root${NC}"
    exit 1
fi

# Variables
APP_DIR="/opt/chess-server"
APP_USER="chessserver"
NODE_VERSION="20.x"

echo -e "\n${YELLOW}📦 Mise à jour du système...${NC}"
apt update && apt upgrade -y

echo -e "\n${YELLOW}📥 Installation de Node.js ${NODE_VERSION}...${NC}"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION} | bash -
apt install -y nodejs
echo -e "${GREEN}✅ Node.js $(node --version) installé${NC}"

echo -e "\n${YELLOW}♟️  Installation de Stockfish...${NC}"
apt install -y stockfish
echo -e "${GREEN}✅ Stockfish installé${NC}"

echo -e "\n${YELLOW}⚙️  Installation de PM2...${NC}"
npm install -g pm2
echo -e "${GREEN}✅ PM2 installé${NC}"

echo -e "\n${YELLOW}👤 Création de l'utilisateur ${APP_USER}...${NC}"
if id "$APP_USER" &>/dev/null; then
    echo -e "${YELLOW}ℹ️  L'utilisateur ${APP_USER} existe déjà${NC}"
else
    useradd -m -s /bin/bash "$APP_USER"
    echo -e "${GREEN}✅ Utilisateur ${APP_USER} créé${NC}"
fi

echo -e "\n${YELLOW}📁 Création du répertoire d'application...${NC}"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
echo -e "${GREEN}✅ Répertoire créé: ${APP_DIR}${NC}"

echo -e "\n${YELLOW}🔥 Installation de UFW (firewall)...${NC}"
apt install -y ufw
ufw --force enable
ufw allow ssh
ufw allow 3000/tcp
echo -e "${GREEN}✅ Firewall configuré${NC}"

echo -e "\n${GREEN}✨ Installation de base terminée!${NC}"
echo -e "\n${YELLOW}Prochaines étapes:${NC}"
echo "1. Transférez vos fichiers vers ${APP_DIR}"
echo "   rsync -avz --exclude 'node_modules' --exclude 'dist' server/ root@votre-ip:${APP_DIR}/"
echo "2. Lancez le script de déploiement:"
echo "   bash /opt/chess-server/scripts/deploy.sh"
