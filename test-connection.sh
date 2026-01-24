#!/bin/bash
# Script de test de connexion au serveur Chess Stockfish
# Usage: bash test-connection.sh

VPS_IP="135.125.201.246"
PORT="3000"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Test du serveur Chess Stockfish        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}🌐 Serveur:${NC} ws://${VPS_IP}:${PORT}"
echo ""

# Test WebSocket avec wscat
if command -v wscat &> /dev/null; then
    echo -e "${GREEN}✅ wscat est installé${NC}"
    echo ""
    echo -e "${YELLOW}📝 Test de connexion WebSocket...${NC}"
    echo ""
    echo "Envoi d'une requête d'analyse..."

    # Message de test
    TEST_MSG='{"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":15,"multiPV":1}'

    echo "$TEST_MSG" | wscat -c "ws://${VPS_IP}:${PORT}" -w 5 2>&1 | head -20

else
    echo -e "${YELLOW}⚠️  wscat n'est pas installé${NC}"
    echo ""
    echo "Installation de wscat :"
    echo "  npm install -g wscat"
    echo ""
    echo "Ou testez manuellement :"
    echo "  wscat -c ws://${VPS_IP}:${PORT}"
fi

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Informations                ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}🌐 URLs de connexion :${NC}"
echo "  ws://${VPS_IP}:${PORT}"
echo "  ws://vps-8058cb7f.vps.ovh.net:${PORT}"
echo ""
echo -e "${YELLOW}📊 Commandes utiles :${NC}"
echo "  # Voir les logs"
echo "  ssh ubuntu@${VPS_IP} 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml logs -f'"
echo ""
echo "  # Redémarrer le serveur"
echo "  ssh ubuntu@${VPS_IP} 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml restart'"
echo ""
echo "  # Statut du serveur"
echo "  ssh ubuntu@${VPS_IP} 'docker compose -f /home/ubuntu/chess-server/docker-compose.yml ps'"
echo ""
echo -e "${YELLOW}🧪 Message de test à envoyer :${NC}"
echo '  {"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":15,"multiPV":1}'
