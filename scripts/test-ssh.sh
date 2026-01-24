#!/bin/bash
# Test de connexion SSH
VPS_IP="135.125.201.246"

echo "🧪 Test de connexion SSH..."
echo "=============================="
echo ""

if ssh -o BatchMode=yes -o ConnectTimeout=5 root@${VPS_IP} "echo 'OK'" 2>/dev/null | grep -q "OK"; then
    echo "✅ Connexion SSH fonctionnelle !"
    echo ""
    echo "📊 Informations du VPS :"
    ssh root@${VPS_IP} "uname -a; echo ''; free -h; echo ''; df -h /"
    echo ""
    echo "🚀 Vous pouvez maintenant lancer l'installation !"
    echo ""
    echo "Choix 1 - Docker (rapide) :"
    echo "  cd /Users/timothe/dev/chess"
    echo "  bash scripts/install-docker.sh"
    echo ""
    echo "Choix 2 - Classique (performances max) :"
    echo "  cd /Users/timothe/dev/chess"
    echo "  bash scripts/full-install.sh"
else
    echo "❌ Connexion SSH non fonctionnelle"
    echo ""
    echo "Vérifiez que vous avez bien ajouté votre clé SSH dans le panneau de contrôle"
    echo ""
    echo "Votre clé publique :"
    cat ~/.ssh/id_ed25519.pub
    echo ""
    echo "Test manuel :"
    echo "  ssh root@${VPS_IP}"
fi
