#!/bin/bash
# Configuration SSH pour VPS OVH
VPS_IP="135.125.201.246"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Configuration VPS OVH + Chess     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Test de connexion
echo -e "${YELLOW}🔍 Test de connexion SSH...${NC}"
if ssh -o BatchMode=yes -o ConnectTimeout=5 root@${VPS_IP} "echo 'OK'" 2>/dev/null | grep -q "OK"; then
    echo -e "${GREEN}✅ SSH déjà configuré !${NC}"
    READY=true
else
    echo -e "${YELLOW}⚠️  SSH non configuré${NC}"
    READY=false

    echo ""
    echo -e "${YELLOW}OVH vous a envoyé un email avec :${NC}"
    echo "  - L'IP du VPS : ${VPS_IP}"
    echo "  - Le mot de passe root temporaire"
    echo ""
    echo -e "${YELLOW}Avez-vous reçu le mot de passe ? (o/n)${NC}"
    read -r has_password

    if [ "$has_password" = "o" ] || [ "$has_password" = "O" ]; then
        echo ""
        echo -e "${YELLOW}Entrez le mot de passe OVH :${NC}"
        read -s ovh_password
        echo ""

        # Tentative d'ajout de la clé
        echo -e "${YELLOW}📤 Ajout de la clé SSH...${NC}"

        cat > /tmp/ovh-ssh-add.exp << EOF
#!/usr/bin/expect -f
set timeout 30
set password "$ovh_password"
set ip "$VPS_IP"
set home "$HOME"

spawn ssh-copy-id -o StrictHostKeyChecking=no -i \$home/.ssh/id_ed25519.pub root@\$ip

expect {
    "password:" {
        send "\$password\r"
        expect {
            "password:" {
                puts "❌ Mot de passe incorrect"
                exit 1
            }
            eof {
                puts "✅ Clé ajoutée"
                exit 0
            }
        }
    }
    timeout {
        puts "❌ Timeout"
        exit 1
    }
}
EOF
        chmod +x /tmp/ovh-ssh-add.exp
        /tmp/ovh-ssh-add.exp

        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ Clé SSH configurée !${NC}"
            READY=true

            # Changement du mot de passe root
            echo ""
            echo -e "${YELLOW}🔐 Voulez-vous changer le mot de passe root ? (o/n)${NC}"
            read -r change_pwd

            if [ "$change_pwd" = "o" ] || [ "$change_pwd" = "O" ]; then
                echo -e "${YELLOW}Nouveau mot de passe root :${NC}"
                read -s new_password
                ssh root@${VPS_IP} "echo 'root:$new_password' | chpasswd"
                echo -e "${GREEN}✅ Mot de passe changé${NC}"
            fi
        else
            echo -e "${RED}❌ Erreur lors de l'ajout de la clé${NC}"
        fi
    else
        echo ""
        echo -e "${YELLOW}📝 Ajoutez votre clé manuellement :${NC}"
        echo ""
        echo "1. Allez sur https://www.ovh.com/manager/"
        echo "2. Public Cloud → Project Management → SSH Keys"
        echo "3. Add SSH Key"
        echo "4. Collez cette clé :"
        echo ""
        cat ~/.ssh/id_ed25519.pub
        echo ""
        echo "5. Puis redémarrez le VPS depuis le panel OVH"
        echo ""
        read -p "Appuyez sur Entrée après avoir ajouté la clé..."

        # Re-test
        if ssh -o BatchMode=yes -o ConnectTimeout=5 root@${VPS_IP} "echo 'OK'" 2>/dev/null | grep -q "OK"; then
            echo -e "${GREEN}✅ SSH maintenant configuré !${NC}"
            READY=true
        else
            echo -e "${RED}❌ Toujours pas de connexion${NC}"
            echo "Essayez de redémarrer le VPS depuis le panel OVH"
            exit 1
        fi
    fi
fi

if [ "$READY" = true ]; then
    echo ""
    echo -e "${GREEN}✅ VPS prêt à l'emploi !${NC}"
    echo ""
    echo -e "${YELLOW}📊 Informations du VPS :${NC}"
    ssh root@${VPS_IP} << 'ENDSSH'
echo "OS: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"
echo "Kernel: $(uname -r)"
echo "CPU: $(nproc) cores"
echo "RAM: $(free -h | grep Mem | awk '{print $2}')"
echo "Disk: $(df -h / | tail -1 | awk '{print $2}')"
ENDSSH

    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║      Installation du serveur Chess     ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Choisissez votre méthode :${NC}"
    echo ""
    echo "  1) Docker (Rapide - 5 min)"
    echo "  2) Classique (Performances max - 10 min)"
    echo "  3) Plus tard"
    echo ""
    read -p "Votre choix (1/2/3) : " choice

    case $choice in
        1)
            echo -e "\n${GREEN}🐳 Installation Docker...${NC}"
            bash "$(dirname "$0")/install-docker.sh"
            ;;
        2)
            echo -e "\n${GREEN}⚙️  Installation Classique...${NC}"
            bash "$(dirname "$0")/full-install.sh"
            ;;
        3)
            echo -e "\n${YELLOW}Pour installer plus tard :${NC}"
            echo "  Docker : bash scripts/install-docker.sh"
            echo "  Classique : bash scripts/full-install.sh"
            ;;
        *)
            echo -e "${RED}Choix invalide${NC}"
            ;;
    esac
fi
