/**
 * Try to fetch Chess.com game analysis via their API
 *
 * Flow discovered from intercepting:
 * 1. GET https://www.chess.com/callback/auth/service/analysis?game_id=XXX&game_type=live
 *    → Returns a token
 * 2. Connect WSS wss://analysis.chess.com/v1/legacy/game-analysis
 *    → Receive analysis results
 *
 * Note: Step 1 requires authentication (Chess.com session cookies)
 * Let's test what we can do without auth and with auth
 */

const GAME_ID = process.argv[2] || '166557730796';
const GAME_TYPE = process.argv[3] || 'live';

console.log(`\nTesting Chess.com analysis API for game ${GAME_ID} (${GAME_TYPE})\n`);

// ─── Method 1: Try the callback API (needs auth) ───
async function tryCallbackAPI() {
  console.log('--- Method 1: Callback Auth API ---');
  const url = `https://www.chess.com/callback/auth/service/analysis?game_id=${GAME_ID}&game_type=${GAME_TYPE}`;
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      }
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text.slice(0, 500)}`);

    if (res.ok) {
      try {
        const data = JSON.parse(text);
        console.log('Token received:', data.token ? data.token.slice(0, 50) + '...' : 'none');
        console.log('URL:', data.url || 'none');
        return data;
      } catch {}
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
  return null;
}

// ─── Method 2: Try direct game data API ───
async function tryGameDataAPI() {
  console.log('\n--- Method 2: Game Data API ---');
  const url = `https://www.chess.com/callback/live/game/${GAME_ID}`;
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json();
    console.log(`Game found: ${data.game?.pgnHeaders?.White} vs ${data.game?.pgnHeaders?.Black}`);
    console.log(`Has analysis data: ${!!data.game?.analysis}`);
    console.log(`Available keys: ${Object.keys(data.game || {}).join(', ')}`);
    return data;
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
  return null;
}

// ─── Method 3: Try the public analysis endpoint ───
async function tryPublicAnalysis() {
  console.log('\n--- Method 3: Public Analysis Page ---');
  const url = `https://www.chess.com/analysis/game/live/${GAME_ID}`;
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    });
    console.log(`Status: ${res.status}`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);
    // Don't print full HTML, just check if it redirects or gives data
    const text = await res.text();
    console.log(`Response size: ${text.length} chars`);

    // Check if there's embedded analysis data in the HTML
    if (text.includes('analysisData') || text.includes('CAPS')) {
      console.log('Found analysis data in HTML!');
      const match = text.match(/analysisData\s*[=:]\s*({[^}]+})/);
      if (match) console.log('Data:', match[1].slice(0, 200));
    }
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

// ─── Method 4: Try the computer analysis callback ───
async function tryComputerAnalysis() {
  console.log('\n--- Method 4: Computer Analysis Callback ---');
  const url = `https://www.chess.com/callback/analysis/game/live/${GAME_ID}`;
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      }
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text.slice(0, 500)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

// ─── Method 5: Try CAPS endpoint directly ───
async function tryCAPSEndpoint() {
  console.log('\n--- Method 5: CAPS/Accuracy endpoint ---');
  const url = `https://www.chess.com/callback/game/accuracy/live/${GAME_ID}`;
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      }
    });
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response: ${text.slice(0, 500)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

// ─── Method 6: Try PGN download with analysis ───
async function tryPGNDownload() {
  console.log('\n--- Method 6: PGN with analysis ---');
  const url = `https://www.chess.com/callback/live/game/${GAME_ID}?all=true`;
  console.log(`GET ${url}`);

  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    console.log(`Status: ${res.status}`);
    const data = await res.json();

    // Check for any analysis-related fields
    const gameKeys = Object.keys(data.game || {});
    console.log(`Game keys: ${gameKeys.join(', ')}`);

    if (data.game?.moveList) console.log(`moveList: ${data.game.moveList.slice(0, 50)}...`);
    if (data.game?.accuracies) console.log(`accuracies: ${JSON.stringify(data.game.accuracies)}`);
    if (data.game?.caps) console.log(`caps: ${JSON.stringify(data.game.caps)}`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

// ─── Method 7: Try the WebSocket analysis endpoint ───
async function tryWSAnalysis() {
  console.log('\n--- Method 7: WebSocket Analysis (no auth) ---');
  const wsUrl = 'wss://analysis.chess.com/v1/legacy/game-analysis';
  console.log(`Connecting to ${wsUrl}...`);

  try {
    // Dynamic import for WebSocket
    const { WebSocket } = await import('ws');

    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => {
        console.log('Timeout (5s)');
        ws.close();
        resolve();
      }, 5000);

      ws.on('open', () => {
        console.log('Connected!');
        // Try sending a request without token
        const msg = JSON.stringify({
          action: 'analyzeGame',
          data: {
            gameId: GAME_ID,
            gameType: GAME_TYPE,
          }
        });
        console.log(`Sending: ${msg}`);
        ws.send(msg);
      });

      ws.on('message', (data) => {
        const text = data.toString();
        console.log(`Received (${text.length} chars): ${text.slice(0, 300)}...`);
        clearTimeout(timeout);
        ws.close();
        resolve(text);
      });

      ws.on('error', (err) => {
        console.log(`WS Error: ${err.message}`);
        clearTimeout(timeout);
        resolve();
      });

      ws.on('close', (code, reason) => {
        console.log(`WS Closed: ${code} ${reason}`);
      });
    });
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

async function main() {
  await tryCallbackAPI();
  await tryGameDataAPI();
  await tryComputerAnalysis();
  await tryCAPSEndpoint();
  await tryPGNDownload();
  await tryWSAnalysis();
  // Skip HTML page (too noisy)
}

main().catch(console.error);
