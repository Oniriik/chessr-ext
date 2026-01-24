#!/bin/bash
# Script pour créer un package ZIP de l'extension
# Usage: bash package.sh [dev|prod]

MODE=${1:-prod}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Package Extension Chessr            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

if [ "$MODE" != "dev" ] && [ "$MODE" != "prod" ]; then
    echo -e "${RED}❌ Mode invalide. Utilisez 'dev' ou 'prod'${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Mode: ${MODE}${NC}"
echo ""

# Nettoyage
echo -e "${YELLOW}🧹 Nettoyage...${NC}"
npm run clean

# Build
echo -e "${YELLOW}🔨 Build de l'extension...${NC}"
if [ "$MODE" == "prod" ]; then
    npm run build:prod
else
    npm run build:dev
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erreur lors du build${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Build réussi${NC}"

# Vérification du dist
if [ ! -d "dist" ]; then
    echo -e "${RED}❌ Dossier dist/ non trouvé${NC}"
    exit 1
fi

# Création du package
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PACKAGE_NAME="chessr-extension-${MODE}-${TIMESTAMP}.zip"

echo ""
echo -e "${YELLOW}📦 Création du package...${NC}"
cd dist
zip -r "../${PACKAGE_NAME}" . -x "*.map" "*.DS_Store"
cd ..

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Erreur lors de la création du ZIP${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Package créé : ${PACKAGE_NAME}${NC}"

# Informations
FILE_SIZE=$(du -h "${PACKAGE_NAME}" | cut -f1)
echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           Package Info                 ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Fichier :${NC} ${PACKAGE_NAME}"
echo -e "${YELLOW}Taille :${NC} ${FILE_SIZE}"
echo -e "${YELLOW}Mode :${NC} ${MODE}"

if [ "$MODE" == "prod" ]; then
    echo -e "${YELLOW}Serveur :${NC} ws://135.125.201.246:3000"
else
    echo -e "${YELLOW}Serveur :${NC} ws://localhost:3000"
fi

echo ""
echo -e "${GREEN}✨ Package prêt à être distribué !${NC}"
echo ""
echo -e "${YELLOW}Pour installer :${NC}"
echo "  1. Ouvrir chrome://extensions/"
echo "  2. Activer le 'Mode développeur'"
echo "  3. Glisser-déposer le fichier ${PACKAGE_NAME}"
echo "     OU décompresser et charger le dossier"
