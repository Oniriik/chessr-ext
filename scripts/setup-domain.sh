#!/bin/bash
# Script de configuration du domaine ws.chessr.io
# Usage: bash setup-domain.sh

set -e

SERVER_IP="135.125.201.246"
SERVER_USER="ubuntu"
DOMAIN="ws.chessr.io"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Configuration de ${DOMAIN}              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# Vérifier que le fichier de config existe
if [ ! -f "nginx/ws.chessr.io.conf" ]; then
    echo -e "${RED}❌ Fichier de configuration NGINX introuvable${NC}"
    exit 1
fi

# Étape 1: Copier la configuration NGINX
echo -e "${YELLOW}📦 Étape 1: Copie de la configuration NGINX...${NC}"
scp nginx/ws.chessr.io.conf ${SERVER_USER}@${SERVER_IP}:/tmp/
echo -e "${GREEN}✅ Configuration copiée${NC}"
echo ""

# Étape 2: Installer et configurer sur le serveur
echo -e "${YELLOW}🔧 Étape 2: Configuration du serveur...${NC}"
ssh ${SERVER_USER}@${SERVER_IP} << 'ENDSSH'
set -e

# Installer certbot si pas déjà fait
if ! command -v certbot &> /dev/null; then
    echo "Installation de certbot..."
    sudo apt update
    sudo apt install -y certbot python3-certbot-nginx
fi

# Copier la config NGINX
echo "Installation de la configuration NGINX..."
sudo mv /tmp/ws.chessr.io.conf /etc/nginx/sites-available/ws.chessr.io

# Créer un lien symbolique
sudo ln -sf /etc/nginx/sites-available/ws.chessr.io /etc/nginx/sites-enabled/ws.chessr.io

# Tester la configuration NGINX (sans SSL d'abord)
echo "Test de la configuration NGINX..."
sudo nginx -t

echo "✅ Configuration installée"
ENDSSH

echo -e "${GREEN}✅ Serveur configuré${NC}"
echo ""

# Étape 3: Instructions DNS
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           CONFIGURATION DNS              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Configure ces enregistrements DNS chez ton registrar:${NC}"
echo ""
echo "Type: A"
echo "Nom: ws"
echo "Valeur: ${SERVER_IP}"
echo "TTL: 300 (ou Auto)"
echo ""
echo -e "${YELLOW}Attends quelques minutes que le DNS se propage...${NC}"
echo ""
read -p "Appuie sur ENTER quand le DNS est configuré et propagé..."
echo ""

# Étape 4: Tester le DNS
echo -e "${YELLOW}🔍 Étape 3: Vérification DNS...${NC}"
DNS_CHECK=$(dig +short ${DOMAIN} | tail -n1)
if [ "$DNS_CHECK" == "$SERVER_IP" ]; then
    echo -e "${GREEN}✅ DNS configuré correctement: ${DOMAIN} → ${SERVER_IP}${NC}"
else
    echo -e "${RED}❌ DNS non configuré ou non propagé${NC}"
    echo "Attendu: ${SERVER_IP}"
    echo "Reçu: ${DNS_CHECK}"
    echo ""
    echo "Attends quelques minutes et réessaie..."
    exit 1
fi
echo ""

# Étape 5: Obtenir le certificat SSL
echo -e "${YELLOW}🔒 Étape 4: Obtention du certificat SSL...${NC}"
ssh ${SERVER_USER}@${SERVER_IP} << ENDSSH
set -e

# Obtenir le certificat SSL avec certbot
echo "Obtention du certificat SSL pour ${DOMAIN}..."
sudo certbot certonly --nginx -d ${DOMAIN} --non-interactive --agree-tos --email contact@chessr.io

# Recharger NGINX
echo "Rechargement de NGINX..."
sudo systemctl reload nginx

echo "✅ Certificat SSL installé"
ENDSSH

echo -e "${GREEN}✅ Certificat SSL installé${NC}"
echo ""

# Étape 6: Vérifier que tout fonctionne
echo -e "${YELLOW}🧪 Étape 5: Test de connexion...${NC}"
if command -v wscat &> /dev/null; then
    echo "Test WebSocket sécurisé..."
    echo '{"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":10,"multiPV":1}' | \
        timeout 5 wscat -c "wss://${DOMAIN}" -w 3 2>&1 | head -10
else
    echo "wscat non installé, test manuel requis"
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
echo "  1. Mettre à jour l'extension pour utiliser wss://${DOMAIN}"
echo "  2. Rebuild et recharger l'extension"
echo ""
echo -e "${YELLOW}🔧 Commandes utiles:${NC}"
echo "  # Tester la connexion"
echo "  wscat -c wss://${DOMAIN}"
echo ""
echo "  # Voir les logs"
echo "  ssh ${SERVER_USER}@${SERVER_IP} 'sudo tail -f /var/log/nginx/ws.chessr.io-access.log'"
echo ""
echo "  # Renouveler le certificat SSL (auto, mais manuel si besoin)"
echo "  ssh ${SERVER_USER}@${SERVER_IP} 'sudo certbot renew'"
echo ""
