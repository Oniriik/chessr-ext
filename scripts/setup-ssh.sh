#!/bin/bash
# Script pour configurer SSH sur le VPS
# Usage: bash setup-ssh.sh votre-ip-vps

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$1" ]; then
    echo -e "${RED}❌ Usage: bash setup-ssh.sh IP-DU-VPS${NC}"
    echo "Exemple: bash setup-ssh.sh 192.168.1.100"
    exit 1
fi

VPS_IP=$1

echo "🔐 Configuration SSH pour ${VPS_IP}"
echo "===================================="

# Vérifier que la clé existe
if [ ! -f ~/.ssh/id_ed25519.pub ]; then
    echo -e "${RED}❌ Clé SSH non trouvée${NC}"
    echo "Génération d'une nouvelle clé..."
    ssh-keygen -t ed25519 -C "timothe@lempire.co" -f ~/.ssh/id_ed25519 -N ""
fi

echo -e "\n${YELLOW}📤 Copie de la clé SSH vers le VPS...${NC}"
echo "Vous allez devoir entrer le mot de passe du VPS"

# Copier la clé
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@${VPS_IP}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Clé SSH copiée avec succès !${NC}"

    echo -e "\n${YELLOW}🧪 Test de connexion...${NC}"
    ssh -o BatchMode=yes -o ConnectTimeout=5 root@${VPS_IP} "echo 'Connexion réussie !'" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Connexion SSH fonctionnelle !${NC}"

        echo -e "\n${YELLOW}🔒 Sécurisation du VPS...${NC}"
        echo "Désactivation de l'authentification par mot de passe..."

        ssh root@${VPS_IP} << 'ENDSSH'
# Backup de la config SSH
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.backup

# Modification de la config
sed -i 's/#*PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/#*PubkeyAuthentication no/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#*PermitRootLogin yes/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config

# Redémarrage SSH
systemctl restart sshd

echo "✅ Configuration SSH sécurisée"
ENDSSH

        echo -e "${GREEN}✅ VPS sécurisé ! Les mots de passe sont désactivés.${NC}"
        echo -e "\n${YELLOW}📝 Vous pouvez maintenant vous connecter avec :${NC}"
        echo "   ssh root@${VPS_IP}"

    else
        echo -e "${YELLOW}⚠️  La connexion automatique ne fonctionne pas encore${NC}"
        echo "Essayez manuellement : ssh root@${VPS_IP}"
    fi
else
    echo -e "${RED}❌ Erreur lors de la copie de la clé${NC}"
    echo "Vérifiez que le VPS est accessible et que vous avez le bon mot de passe"
fi
