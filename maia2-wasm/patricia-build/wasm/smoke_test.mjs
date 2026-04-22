// Comprehensive smoke test for Patricia WASM.

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const createModule = require("./patricia_node.js");

const output = [];
const mod = await createModule({
  print: (line) => output.push(line),
  printErr: (line) => output.push("[err] " + line),
});

const command = mod.cwrap("wasm_command", null, ["string"]);
const init = mod.cwrap("wasm_init", null, []);

init();

function drain() {
  const lines = output.splice(0);
  return lines;
}

// 1. UCI handshake
command("uci");
const uciLines = drain();
const optionLines = uciLines.filter((l) => l.startsWith("option name "));
console.log(`UCI options advertised: ${optionLines.length}`);
optionLines.forEach((l) => console.log(`  ${l}`));
const uciok = uciLines.find((l) => l === "uciok");
console.log(`uciok: ${uciok ? "YES" : "MISSING"}`);

// 2. Set MultiPV=3 + UCI_LimitStrength + UCI_Elo=1500
command("setoption name MultiPV value 3");
command("setoption name UCI_LimitStrength value true");
command("setoption name UCI_Elo value 1500");
command("isready");
drain();

// 3. Search Italian start with MultiPV=3
command("position fen r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3");
const t0 = performance.now();
command("go movetime 500");
const dt = performance.now() - t0;

const lines = drain();
const pvs = lines.filter((l) => l.startsWith("info") && l.includes(" multipv "));
console.log(`\nItalian opening search ${dt.toFixed(0)}ms, MultiPV=3 with UCI_Elo=1500`);
const lastByPV = {};
for (const l of pvs) {
  const m = l.match(/multipv (\d+).*pv (\S+)/);
  if (m) lastByPV[m[1]] = m[0];
}
for (const k of Object.keys(lastByPV).sort()) {
  console.log(`  pv${k}: ${lastByPV[k]}`);
}
const bestmove = lines.find((l) => l.startsWith("bestmove"));
console.log(`bestmove: ${bestmove}`);

process.exit(uciok && bestmove ? 0 : 1);
