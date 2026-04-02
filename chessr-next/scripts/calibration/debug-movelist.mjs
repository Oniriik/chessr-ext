/**
 * Debug moveList decoding by comparing with known PGN
 */
import { execSync } from 'child_process';

const pgn = '1. c3 d5 2. d3 Nf6 3. g3 e5 4. Bg2 Bd6 5. Qb3 c6 6. Bg5 Nbd7 7. Nd2 a5 8. c4 d4 9. Ne4 Bb4+ 10. Kf1 Nxe4 11. Bxd8 Nd2+ 12. Ke1 Nxb3+ 13. Kf1 Nxa1 14. Bg5 Nc2 15. Nf3 h6 16. Bc1 a4 17. a3 Be7 18. e4 dxe3 19. fxe3 Nc5 20. Ke2 e4 21. Kd2 exf3 22. Bxf3 Na1 23. d4 Ncb3+ 24. Kc3 Bf5 25. e4 Bh7 26. d5 Bf6+ 27. Kb4 Nc2#';
const ml = 'ksZJlt!Tow0Kfo9RdrYQcM5ZblWGsAJBlCRzefTCM7Clfelrefra7Makgv3VMcGyiqz0mCBunuZIfmKCmlCvovkatBIrls6LuCL3BJ0Tszak';

// Get UCI from PGN
import { writeFileSync } from 'fs';
const pyFile = '/tmp/debug_ml.py';
writeFileSync(pyFile, `
import chess, json
pgn = """${pgn}"""
tokens = pgn.replace('.', ' ').split()
sans = [m for m in tokens if not m[0].isdigit() and m not in ['0-1','1-0','1/2-1/2']]
board = chess.Board()
uci = []
for san in sans:
    move = board.parse_san(san)
    uci.append(move.uci())
    board.push(move)
print(json.dumps(uci))
`);
const uciMoves = JSON.parse(execSync(`python3 ${pyFile}`, { encoding: 'utf8' }));

function charToIdx(ch) {
  const cc = ch.charCodeAt(0);
  if (cc >= 97 && cc <= 122) return cc - 97;
  if (cc >= 65 && cc <= 90) return cc - 65 + 26;
  if (cc >= 48 && cc <= 57) return cc - 48 + 52;
  if (cc === 33) return 62; // !
  if (cc === 63) return 63; // ?
  return -1;
}

function idxToSquare(idx) {
  return String.fromCharCode(97 + (idx % 8)) + (Math.floor(idx / 8) + 1);
}

console.log(`moveList: ${ml.length} chars, Expected: ${uciMoves.length} moves\n`);

let i = 0;
for (let m = 0; m < uciMoves.length; m++) {
  if (i + 1 >= ml.length) { console.log(`Ran out of chars at move ${m + 1}`); break; }

  const from = idxToSquare(charToIdx(ml[i]));
  const to = idxToSquare(charToIdx(ml[i + 1]));
  let decoded = from + to;
  i += 2;

  const expected = uciMoves[m];

  // Check if expected has promotion
  if (expected.length === 5) {
    if (i < ml.length) {
      decoded += ml[i];
      i++;
    }
  }

  const ok = decoded === expected;
  if (!ok) {
    console.log(`#${m + 1} MISMATCH: chars '${ml[i - 2]}${ml[i - 1]}' → ${decoded}, expected ${expected}`);
    console.log(`  Remaining: ${ml.slice(i - 2, i + 6)}`);
    // Try to resync
    break;
  }
}

console.log(`\nConsumed ${i}/${ml.length} chars for ${uciMoves.length} moves`);
if (i === ml.length) {
  console.log('✓ Perfect decode! All chars consumed.');
} else {
  console.log(`Remaining: '${ml.slice(i)}'`);
}
