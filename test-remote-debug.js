const WebSocket = require('./server/node_modules/ws');

const REMOTE_URL = 'wss://ws.chessr.io';
const TEST_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

console.log('🔗 Connexion au serveur distant:', REMOTE_URL);
const ws = new WebSocket(REMOTE_URL);

let messageCount = 0;
let readyReceived = false;
let analyzeSent = false;

ws.on('open', () => {
  console.log('✅ [00:00] Connecté au serveur distant !');
});

ws.on('message', (data) => {
  const now = new Date().toISOString().split('T')[1].slice(0, 8);
  messageCount++;

  try {
    const message = JSON.parse(data.toString());
    console.log(`📩 [${now}] Message #${messageCount}:`, message.type);

    if (message.type === 'ready') {
      readyReceived = true;
      console.log('✅ Serveur prêt');
      console.log('📤 Envoi de la demande d\'analyse...');

      const request = {
        type: 'analyze',
        fen: TEST_FEN,
        searchMode: 'depth',
        depth: 10,
        moveTime: 1000,
        elo: 1500,
        mode: 'balanced',
        multiPV: 3
      };

      console.log('📤 Requête:', JSON.stringify(request));
      ws.send(JSON.stringify(request));
      analyzeSent = true;
      console.log('✅ Requête envoyée');

    } else if (message.type === 'info') {
      console.log(`  📊 Info - Profondeur: ${message.depth}, Éval: ${message.evaluation}`);

    } else if (message.type === 'result') {
      console.log('✅ RÉSULTAT REÇU !');
      console.log('  - bestMove:', message.bestMove);
      console.log('  - evaluation:', message.evaluation);
      console.log('  - depth:', message.depth);
      console.log('  - lines:', message.lines?.length);
      setTimeout(() => ws.close(), 100);

    } else if (message.type === 'error') {
      console.error('❌ Erreur serveur:', message.message);
      ws.close();

    } else {
      console.log('  ⚠️  Type de message inconnu:', message.type, message);
    }
  } catch (err) {
    console.error('❌ Erreur parsing:', err.message);
    console.error('   Data brute:', data.toString());
  }
});

ws.on('close', (event) => {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('❌ Connexion fermée');
  console.log('  Code:', event.code);
  console.log('  Raison:', event.reason || 'aucune');
  console.log('  Messages reçus:', messageCount);
  console.log('  Ready reçu:', readyReceived);
  console.log('  Analyze envoyé:', analyzeSent);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(event.code === 1000 ? 0 : 1);
});

ws.on('error', (err) => {
  console.error('❌ Erreur WebSocket:', err.message);
  process.exit(1);
});

// Timeout après 30 secondes
setTimeout(() => {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⏱️  TIMEOUT après 30 secondes');
  console.log('  Messages reçus:', messageCount);
  console.log('  Ready reçu:', readyReceived);
  console.log('  Analyze envoyé:', analyzeSent);
  console.log('  ❌ Aucun résultat reçu du serveur');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  ws.close();
  process.exit(1);
}, 30000);
