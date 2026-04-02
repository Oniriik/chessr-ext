/**
 * Decode Chess.com moveList encoding
 *
 * Chess.com encodes: each char maps to a square index 0-63
 * Index 0 = a1, 1 = b1, ..., 7 = h1, 8 = a2, ..., 63 = h8
 * Character mapping: starts from '!' (ASCII 33) = index 0
 *
 * Special 3rd char for promotions: 'q','r','b','n'
 */

function decodeSquare(charCode) {
  const idx = charCode - 33; // '!' = 0 = a1
  const file = String.fromCharCode('a'.charCodeAt(0) + (idx % 8));
  const rank = Math.floor(idx / 8) + 1;
  return `${file}${rank}`;
}

function decodeMoveList(moveList) {
  const moves = [];
  let i = 0;

  while (i < moveList.length) {
    if (i + 1 >= moveList.length) break;

    const fromChar = moveList.charCodeAt(i);
    const toChar = moveList.charCodeAt(i + 1);
    const from = decodeSquare(fromChar);
    const to = decodeSquare(toChar);
    i += 2;

    // Check for promotion
    let promotion = '';
    if (i < moveList.length) {
      const next = moveList[i];
      // Promotion if pawn reaches rank 1 or 8
      if ((to[1] === '8' || to[1] === '1') && 'qrbn'.includes(next)) {
        promotion = next;
        i++;
      }
    }

    moves.push(`${from}${to}${promotion}`);
  }

  return moves;
}

const moveList = "ksZJlt!Tow0Kfo9RdrYQcM5ZblWGsAJBlCRzefTCM7Clfelrefra7Makgv3VMcGyiqz0mCBunuZIfmKCmlCvovkatBIrls6LuCL3BJ0Tszak";

const moves = decodeMoveList(moveList);

console.log('Decoded moves:');
const moveStrings = [];
for (let i = 0; i < moves.length; i += 2) {
  const num = Math.floor(i / 2) + 1;
  const white = moves[i];
  const black = moves[i + 1] || '';
  moveStrings.push(`${num}. ${white} ${black}`);
  console.log(`  ${num}. ${white} ${black}`);
}

console.log(`\nTotal: ${moves.length} half-moves`);
console.log(`\nMoves array:`);
console.log(JSON.stringify(moves));
