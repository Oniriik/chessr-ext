#!/bin/bash
# Script de test du serveur Chess Stockfish
# Usage: bash test-server.sh [host] [port]

HOST=${1:-localhost}
PORT=${2:-3000}
URL="ws://${HOST}:${PORT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 Test du serveur Chess Stockfish"
echo "=================================="
echo "URL: ${URL}"
echo ""

# Test 1: Vérification de la connexion TCP
echo -e "${YELLOW}Test 1: Connexion TCP...${NC}"
if timeout 3 bash -c "echo > /dev/tcp/${HOST}/${PORT}" 2>/dev/null; then
    echo -e "${GREEN}✅ Port ${PORT} est ouvert${NC}"
else
    echo -e "${RED}❌ Impossible de se connecter au port ${PORT}${NC}"
    exit 1
fi

# Test 2: Vérification WebSocket avec curl
echo -e "\n${YELLOW}Test 2: WebSocket avec curl...${NC}"
RESPONSE=$(curl -i -N -s \
    -H "Connection: Upgrade" \
    -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" \
    -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    --max-time 3 \
    "http://${HOST}:${PORT}" 2>&1)

if echo "$RESPONSE" | grep -q "101 Switching Protocols\|HTTP/1.1 101"; then
    echo -e "${GREEN}✅ WebSocket handshake réussi${NC}"
else
    echo -e "${RED}❌ WebSocket handshake échoué${NC}"
    echo "Réponse: $RESPONSE"
    exit 1
fi

# Test 3: Test avec wscat si disponible
echo -e "\n${YELLOW}Test 3: Test fonctionnel avec wscat...${NC}"
if command -v wscat &> /dev/null; then
    echo "Envoi d'une requête d'analyse..."

    # Message de test
    TEST_MSG='{"type":"analyze","fen":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","searchMode":"depth","depth":10,"multiPV":1}'

    # Envoyer le message et attendre 5 secondes
    RESPONSE=$(echo "$TEST_MSG" | timeout 5 wscat -c "$URL" 2>&1)

    if echo "$RESPONSE" | grep -q "ready\|info\|bestmove"; then
        echo -e "${GREEN}✅ Le serveur répond correctement${NC}"
        echo "Extrait de la réponse:"
        echo "$RESPONSE" | grep -m 3 -E "ready|info|bestmove" | head -3
    else
        echo -e "${YELLOW}⚠️  Réponse inattendue ou timeout${NC}"
        echo "Réponse: $RESPONSE"
    fi
else
    echo -e "${YELLOW}ℹ️  wscat n'est pas installé, test fonctionnel ignoré${NC}"
    echo "Installez wscat pour un test complet: npm install -g wscat"
fi

# Test 4: Vérifier que Stockfish fonctionne (si local)
if [ "$HOST" == "localhost" ] || [ "$HOST" == "127.0.0.1" ]; then
    echo -e "\n${YELLOW}Test 4: Vérification de Stockfish...${NC}"
    if command -v stockfish &> /dev/null; then
        echo -e "${GREEN}✅ Stockfish est installé: $(which stockfish)${NC}"
        echo "Version: $(stockfish --version 2>&1 | head -1)"
    else
        echo -e "${RED}❌ Stockfish n'est pas dans le PATH${NC}"
    fi
fi

echo -e "\n${GREEN}✨ Tests terminés!${NC}"
echo -e "\n${YELLOW}Pour tester manuellement:${NC}"
echo "  wscat -c ${URL}"
echo "  > ${TEST_MSG}"
