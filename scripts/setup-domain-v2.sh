#!/bin/bash
# Script de configuration du domaine ws.chessr.io (version 2 - avec étapes SSL)
# Usage: bash setup-domain-v2.sh

set -e

SERVER_IP="135.125.201.246"
SERVER_USER="ubuntu"
DOMAIN="ws.chessr.io"
EMAIL="contact@chessr.io"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Configuration de ${DOMAIN}              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Vérifier que les fichiers de config existent
if [ ! -f "nginx/ws.chessr.io-http.conf" ] || [ ! -f "nginx/ws.chessr.io.conf" ]; then
    echo -e "${RED}❌ Fichiers de configuration NGINX introuvables${NC}"
    exit 1
fi

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           CONFIGURATION DNS              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Vérifie que le DNS est configuré:${NC}"
echo ""
echo "Type: A"
echo "Nom: ws"
echo "Valeur: ${SERVER_IP}"
echo ""
echo -e "${YELLOW}Vérification automatique dans 3 secondes...${NC}"
sleep 3

# Vérifier le DNS
echo -e "\n${YELLOW}🔍 Vérification DNS...${NC}"
DNS_CHECK=$(dig +short ${DOMAIN} | tail -n1)
if [ "$DNS_CHECK" == "$SERVER_IP" ]; then
    echo -e "${GREEN}✅ DNS configuré correctement: ${DOMAIN} → ${SERVER_IP}${NC}"
else
    echo -e "${RED}❌ DNS non configuré ou non propagé${NC}"
    echo "Attendu: ${SERVER_IP}"
    echo "Reçu: ${DNS_CHECK}"
    echo ""
    echo -e "${YELLOW}Configure le DNS chez ton registrar puis réessaie.${NC}"
    exit 1
fi
echo ""

# Étape 1: Copier les configurations NGINX
echo -e "${YELLOW}📦 Étape 1: Copie des configurations NGINX...${NC}"
scp nginx/ws.chessr.io-http.conf ${SERVER_USER}@${SERVER_IP}:/tmp/
scp nginx/ws.chessr.io.conf ${SERVER_USER}@${SERVER_IP}:/tmp/
echo -e "${GREEN}✅ Configurations copiées${NC}"
echo ""

# Étape 2: Installer certbot et config HTTP temporaire
echo -e "${YELLOW}🔧 Étape 2: Installation de certbot et config HTTP...${NC}"
ssh ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
set -e

# Installer certbot si pas déjà fait
if ! command -v certbot &> /dev/null; then
    echo "Installation de certbot..."
    sudo apt update
    sudo apt install -y certbot
fi

# Installer la config HTTP temporaire
echo "Installation de la configuration HTTP temporaire..."
sudo mv /tmp/ws.chessr.io-http.conf /etc/nginx/sites-available/ws.chessr.io
sudo ln -sf /etc/nginx/sites-available/ws.chessr.io /etc/nginx/sites-enabled/ws.chessr.io

# Tester et recharger NGINX
echo "Test et rechargement NGINX..."
sudo nginx -t
sudo systemctl reload nginx

echo "✅ Configuration HTTP active"
ENDSSH

echo -e "${GREEN}✅ Configuration HTTP installée${NC}"
echo ""

# Étape 3: Obtenir le certificat SSL
echo -e "${YELLOW}🔒 Étape 3: Obtention du certificat SSL...${NC}"
ssh ${SERVER_USER}@${SERVER_IP} << ENDSSH
set -e

# Obtenir le certificat SSL
echo "Obtention du certificat SSL pour ${DOMAIN}..."
sudo certbot certonly --webroot -w /var/www/html -d ${DOMAIN} --non-interactive --agree-tos --email ${EMAIL}

echo "✅ Certificat SSL obtenu"
ENDSSH

echo -e "${GREEN}✅ Certificat SSL installé${NC}"
echo ""

# Étape 4: Activer la configuration HTTPS
echo -e "${YELLOW}🔐 Étape 4: Activation de la configuration HTTPS...${NC}"
ssh ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
set -e

# Installer la configuration HTTPS finale
echo "Installation de la configuration HTTPS..."
sudo mv /tmp/ws.chessr.io.conf /etc/nginx/sites-available/ws.chessr.io

# Tester et recharger NGINX
echo "Test et rechargement NGINX..."
sudo nginx -t
sudo systemctl reload nginx

echo "✅ Configuration HTTPS active"
ENDSSH

echo -e "${GREEN}✅ Configuration HTTPS installée${NC}"
echo ""

# Étape 5: Vérifier que tout fonctionne
echo -e "${YELLOW}🧪 Étape 5: Tests de connexion...${NC}"

# Test HTTPS
echo "Test HTTPS..."
if curl -s -o /dev/null -w "%{http_code}" https://${DOMAIN}/health | grep -q "200"; then
    echo -e "${GREEN}✅ HTTPS fonctionne${NC}"
else
    echo -e "${YELLOW}⚠️  HTTPS ne répond pas comme attendu${NC}"
fi

# Test WebSocket si wscat est installé
if command -v wscat &> /dev/null; then
    echo "Test WebSocket sécurisé..."
    echo '{"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":5,"multiPV":1}' | \
        timeout 5 wscat -c "wss://${DOMAIN}" -w 3 2>&1 | head -5
fi
echo ""

# Récapitulatif
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           ✨ CONFIGURATION OK ✨         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}🎉 Le serveur WebSocket est maintenant accessible sur:${NC}"
echo -e "${YELLOW}   wss://${DOMAIN}${NC}"
echo ""
echo -e "${YELLOW}📝 Prochaines étapes:${NC}"
echo "  1. Rebuild l'extension en production: cd extension && npm run build:prod"
echo "  2. Recharger l'extension dans Chrome (chrome://extensions/)"
echo "  3. Tester sur chess.com"
echo ""
echo -e "${YELLOW}🔧 Commandes utiles:${NC}"
echo "  # Tester la connexion"
echo "  wscat -c wss://${DOMAIN}"
echo ""
echo "  # Voir les logs"
echo "  ssh ${SERVER_USER}@${SERVER_IP} 'sudo tail -f /var/log/nginx/ws.chessr.io-access.log'"
echo ""
echo "  # Renouveler le certificat SSL"
echo "  ssh ${SERVER_USER}@${SERVER_IP} 'sudo certbot renew'"
echo ""
