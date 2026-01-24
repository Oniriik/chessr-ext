#!/bin/bash
# Script de connexion et installation automatique sur le VPS
# Usage: bash connect-vps.sh

VPS_IP="135.125.201.246"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Installation Chess Server sur VPS   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}VPS :${NC} ${VPS_IP}"
echo ""

# Test de connexion
echo -e "${YELLOW}🔍 Test de connexion au VPS...${NC}"
if ssh -o BatchMode=yes -o ConnectTimeout=5 root@${VPS_IP} "echo 'OK'" 2>/dev/null | grep -q "OK"; then
    echo -e "${GREEN}✅ Connexion SSH fonctionnelle !${NC}"
    CONNECTED=true
else
    echo -e "${YELLOW}⚠️  Connexion SSH non configurée${NC}"
    CONNECTED=false

    echo ""
    echo -e "${BLUE}Pour configurer SSH, vous avez 2 options :${NC}"
    echo ""
    echo -e "${YELLOW}Option 1 : Avec mot de passe${NC}"
    echo "  ssh-copy-id -i ~/.ssh/id_ed25519.pub root@${VPS_IP}"
    echo ""
    echo -e "${YELLOW}Option 2 : Via le panneau de contrôle${NC}"
    echo "  Votre clé publique est :"
    echo ""
    cat ~/.ssh/id_ed25519.pub
    echo ""
    echo "  Ajoutez cette clé dans le panneau de contrôle de votre hébergeur"
    echo ""

    read -p "Appuyez sur Entrée après avoir configuré SSH..."

    # Re-test
    if ssh -o BatchMode=yes -o ConnectTimeout=5 root@${VPS_IP} "echo 'OK'" 2>/dev/null | grep -q "OK"; then
        echo -e "${GREEN}✅ Connexion SSH maintenant fonctionnelle !${NC}"
        CONNECTED=true
    else
        echo -e "${RED}❌ Impossible de se connecter. Vérifiez la configuration.${NC}"
        echo ""
        echo "Pour tester manuellement :"
        echo "  ssh root@${VPS_IP}"
        exit 1
    fi
fi

if [ "$CONNECTED" = true ]; then
    echo ""
    echo -e "${YELLOW}🚀 Prêt pour l'installation !${NC}"
    echo ""
    echo -e "${BLUE}Choisissez votre méthode d'installation :${NC}"
    echo ""
    echo "  1) Docker (Recommandé - Installation rapide)"
    echo "  2) Installation classique (Node.js + PM2)"
    echo "  3) Test de connexion seulement"
    echo ""
    read -p "Votre choix (1/2/3) : " choice

    case $choice in
        1)
            echo -e "\n${GREEN}📦 Installation avec Docker${NC}"
            ./scripts/install-docker.sh
            ;;
        2)
            echo -e "\n${GREEN}⚙️  Installation classique${NC}"
            ./scripts/full-install.sh
            ;;
        3)
            echo -e "\n${GREEN}🧪 Test de connexion${NC}"
            ssh root@${VPS_IP} "uname -a; uptime"
            ;;
        *)
            echo -e "${RED}Choix invalide${NC}"
            exit 1
            ;;
    esac
fi
