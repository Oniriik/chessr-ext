#!/bin/bash
# Script de configuration Nginx avec SSL
# Usage: bash setup-nginx.sh votre-domaine.com

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$1" ]; then
    echo -e "${RED}❌ Usage: bash setup-nginx.sh votre-domaine.com${NC}"
    exit 1
fi

DOMAIN=$1

echo "🔧 Configuration Nginx pour ${DOMAIN}"
echo "======================================"

# Vérification root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ Ce script doit être exécuté en tant que root${NC}"
    exit 1
fi

echo -e "\n${YELLOW}📥 Installation de Nginx...${NC}"
apt install -y nginx
echo -e "${GREEN}✅ Nginx installé${NC}"

echo -e "\n${YELLOW}📝 Création de la configuration Nginx...${NC}"
cat > /etc/nginx/sites-available/chess-server << EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name ${DOMAIN};

    # Limite de taux pour éviter les abus
    limit_req_zone \$binary_remote_addr zone=chessapi:10m rate=20r/s;
    limit_req zone=chessapi burst=50 nodelay;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Timeouts pour WebSocket
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Health check endpoint (si vous en ajoutez un)
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
EOF

echo -e "${GREEN}✅ Configuration créée${NC}"

echo -e "\n${YELLOW}🔗 Activation de la configuration...${NC}"
ln -sf /etc/nginx/sites-available/chess-server /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

echo -e "\n${YELLOW}✅ Test de la configuration Nginx...${NC}"
nginx -t

echo -e "\n${YELLOW}🔄 Redémarrage de Nginx...${NC}"
systemctl restart nginx
echo -e "${GREEN}✅ Nginx redémarré${NC}"

echo -e "\n${YELLOW}🔥 Configuration du firewall...${NC}"
ufw allow 'Nginx Full'
echo -e "${GREEN}✅ Firewall configuré${NC}"

echo -e "\n${GREEN}✨ Configuration Nginx terminée!${NC}"
echo -e "\n${YELLOW}Prochaines étapes:${NC}"
echo "1. Assurez-vous que votre domaine ${DOMAIN} pointe vers ce serveur"
echo "2. Installez SSL avec Let's Encrypt:"
echo "   apt install -y certbot python3-certbot-nginx"
echo "   certbot --nginx -d ${DOMAIN}"
echo -e "\n${YELLOW}Test de connexion:${NC}"
echo "  wscat -c ws://${DOMAIN}"
