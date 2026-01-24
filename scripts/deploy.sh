#!/bin/bash
# Script de déploiement de l'application
# À exécuter après avoir transféré les fichiers
# Usage: bash deploy.sh

set -e

APP_DIR="/opt/chess-server"
APP_USER="chessserver"
APP_NAME="chess-stockfish-server"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🚀 Déploiement du serveur Chess Stockfish"
echo "=========================================="

# Vérification que nous sommes dans le bon répertoire
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Erreur: package.json non trouvé${NC}"
    echo "Assurez-vous d'être dans le répertoire ${APP_DIR}"
    exit 1
fi

echo -e "\n${YELLOW}📦 Installation des dépendances...${NC}"
npm install
echo -e "${GREEN}✅ Dépendances installées${NC}"

echo -e "\n${YELLOW}🔨 Build du projet TypeScript...${NC}"
npm run build
echo -e "${GREEN}✅ Build terminé${NC}"

echo -e "\n${YELLOW}⚙️  Vérification de Stockfish...${NC}"
if ! command -v stockfish &> /dev/null; then
    echo -e "${RED}❌ Stockfish n'est pas installé ou n'est pas dans le PATH${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Stockfish trouvé: $(which stockfish)${NC}"

echo -e "\n${YELLOW}🔄 Gestion du processus PM2...${NC}"
if pm2 describe "$APP_NAME" &> /dev/null; then
    echo "Redémarrage de l'application existante..."
    pm2 restart "$APP_NAME"
else
    echo "Démarrage de la nouvelle application..."
    pm2 start dist/index.js --name "$APP_NAME"
    pm2 save
fi

echo -e "${GREEN}✅ Application démarrée${NC}"

echo -e "\n${YELLOW}📊 Statut de l'application:${NC}"
pm2 status "$APP_NAME"

echo -e "\n${GREEN}✨ Déploiement terminé avec succès!${NC}"
echo -e "\n${YELLOW}Commandes utiles:${NC}"
echo "  pm2 logs $APP_NAME          - Voir les logs"
echo "  pm2 restart $APP_NAME       - Redémarrer"
echo "  pm2 stop $APP_NAME          - Arrêter"
echo "  pm2 monit                    - Monitoring en temps réel"
echo -e "\n${YELLOW}Test de connexion:${NC}"
echo "  wscat -c ws://localhost:3000"
