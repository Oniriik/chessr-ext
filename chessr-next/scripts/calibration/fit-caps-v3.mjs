/**
 * Fit CAPS2 using win probability difference instead of raw centipawn difference
 * Chess.com uses: winProb = 50 + 50 * (2/(1+exp(-0.00368208*cp)) - 1)
 */

// Win probability formula (Lichess/Chess.com style)
function winProb(evalPawns) {
  const cp = evalPawns * 100;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Win% difference (always from player perspective, positive = loss)
function winDiff(bestEval, afterEval) {
  return Math.max(0, winProb(bestEval) - winProb(afterEval));
}

// Data from Chess.com analysis (non-book moves with known evals from our SF analysis)
// Game 2: jaxceq vs massnabi (361 vs 322)
// Game 3: thoriqaljabar vs OshKosh2465 (1600 vs 1564)
// Using the positions data from our analysis runs + CC CAPS values

// Chess.com CAPS2 data points from game 2 (positions JSON)
const dataPoints = [
  // Game 2: Alekhine - selected non-book moves with clear CC CAPS2 values
  // Format: { bestEval (our SF), afterEval (our SF), ccCaps2, ccClass }
  // Ply 6: 3...Ng5 — CC: inaccuracy (from CC positions data)
  { bestEval: -1.35, afterEval: -4.22, ccCaps2: 25.13, cls: 'inaccuracy' },
  // Ply 7: 4.h4 — CC: brilliant/great (but eval wise blunder)
  { bestEval: 4.19, afterEval: 1.03, ccCaps2: 20.76, cls: 'miss' },
  // Ply 9: 5.b4 — CC: mistake
  { bestEval: 0.83, afterEval: -0.48, ccCaps2: 36.78, cls: 'mistake' },
  // Ply 10: 5...Nc6 — CC: brilliant/great
  { bestEval: 0.45, afterEval: -1.32, ccCaps2: 23.32, cls: 'mistake' },

  // Game 3: London System - more data points
  // Ply 16: 8...g6 — CC diff 0.42
  { bestEval: -0.67, afterEval: -1.12, ccCaps2: 79.96, cls: 'good' },
  // Ply 18: 9...Nh5 — CC diff 0.59
  { bestEval: -1.10, afterEval: -1.93, ccCaps2: 66.26, cls: 'inaccuracy' },
  // Ply 23: 12.Bxd6 — CC diff 0.50
  { bestEval: 1.10, afterEval: 0.27, ccCaps2: 67.7, cls: 'inaccuracy' },
  // Ply 27: 14.Bxe4 — CC diff 0.84
  { bestEval: 0.18, afterEval: -0.79, ccCaps2: 48.57, cls: 'inaccuracy' },

  // Game 1: Saragossa - 1780 vs 1709
  { bestEval: -0.33, afterEval: -0.71, ccCaps2: 82.06, cls: 'good' }, // 5. Qb3
  { bestEval: 0.63, afterEval: 0.09, ccCaps2: 65.79, cls: 'inaccuracy' }, // from prev data
  { bestEval: 0.84, afterEval: 0.00, ccCaps2: 54.08, cls: 'inaccuracy' },
  { bestEval: 2.14, afterEval: -0.00, ccCaps2: 7.77, cls: 'mistake' },

  // "Best" moves (diff ~0)
  { bestEval: 0.50, afterEval: 0.50, ccCaps2: 100, cls: 'best' },
  { bestEval: -2.0, afterEval: -2.0, ccCaps2: 100, cls: 'best' },
  { bestEval: 5.0, afterEval: 5.0, ccCaps2: 100, cls: 'best' },
];

// Compute winDiff for each data point
console.log('Win% difference vs CAPS2:\n');
console.log(`${'bestEval'.padEnd(9)} | ${'afterEval'.padEnd(10)} | ${'rawDiff'.padEnd(8)} | ${'winDiff%'.padEnd(9)} | ${'ccCaps2'.padEnd(8)} | class`);
console.log('-'.repeat(70));

for (const p of dataPoints) {
  const rd = Math.abs(p.bestEval - p.afterEval).toFixed(2);
  const wd = winDiff(p.bestEval, p.afterEval).toFixed(1);
  console.log(`${p.bestEval.toFixed(2).padEnd(9)} | ${p.afterEval.toFixed(2).padEnd(10)} | ${rd.padEnd(8)} | ${wd.padEnd(9)} | ${p.ccCaps2.toFixed(1).padEnd(8)} | ${p.cls}`);
}

// Fit: CAPS2 = f(winDiff%)
// Try: CAPS2 = max(0, 100 * exp(-k * winDiff^p))
// With optional dead zone

console.log('\n--- Fitting CAPS2 = f(winDiff%) ---\n');

function capsFormula(wd, threshold, k, p) {
  if (wd <= threshold) return 100;
  const adj = wd - threshold;
  return Math.max(0, 100 * Math.exp(-k * Math.pow(adj, p)));
}

function mse(points, fn) {
  let sum = 0;
  for (const pt of points) {
    const wd = winDiff(pt.bestEval, pt.afterEval);
    const pred = fn(wd);
    sum += (pred - pt.ccCaps2) ** 2;
  }
  return sum / points.length;
}

let bestErr = Infinity;
let bestParams = null;

for (let t = 0; t <= 3; t += 0.1) {
  for (let k = 0.01; k <= 1.0; k += 0.01) {
    for (let p = 0.5; p <= 3.0; p += 0.05) {
      const fn = (wd) => capsFormula(wd, t, k, p);
      const err = mse(dataPoints, fn);
      if (err < bestErr) {
        bestErr = err;
        bestParams = { threshold: t, k, p };
      }
    }
  }
}

const { threshold, k, p } = bestParams;
console.log(`Best fit: CAPS2 formula using win% difference`);
console.log(`  if winDiff <= ${threshold.toFixed(1)}: CAPS2 = 100`);
console.log(`  else: CAPS2 = 100 * exp(-${k.toFixed(3)} * (winDiff - ${threshold.toFixed(1)})^${p.toFixed(2)})`);
console.log(`  RMSE: ${Math.sqrt(bestErr).toFixed(1)}\n`);

// Show predictions
console.log(`${'winDiff%'.padEnd(9)} | ${'actual'.padEnd(8)} | ${'predicted'.padEnd(10)} | ${'error'.padEnd(8)} | class`);
console.log('-'.repeat(55));

for (const pt of dataPoints) {
  const wd = winDiff(pt.bestEval, pt.afterEval);
  const pred = capsFormula(wd, threshold, k, p);
  const err = (pred - pt.ccCaps2).toFixed(1);
  console.log(`${wd.toFixed(1).padEnd(9)} | ${pt.ccCaps2.toFixed(1).padEnd(8)} | ${pred.toFixed(1).padEnd(10)} | ${err.padEnd(8)} | ${pt.cls}`);
}

// Classification thresholds based on winDiff%
console.log('\n--- PROPOSED CLASSIFICATION (winDiff% based) ---\n');
const thresholds = [
  ['best',       0, 1.0],
  ['excellent',  1.0, 3.0],
  ['good',       3.0, 6.0],
  ['inaccuracy', 6.0, 12.0],
  ['mistake',    12.0, 25.0],
  ['blunder',    25.0, 100],
];

for (const [cls, min, max] of thresholds) {
  const c1 = capsFormula(min, threshold, k, p).toFixed(0);
  const c2 = capsFormula(max, threshold, k, p).toFixed(0);
  console.log(`  ${cls.padEnd(14)}: winDiff% (${min}-${max})  →  CAPS2 [${c2}-${c1}]`);
}

console.log('\n--- TYPESCRIPT CODE ---\n');
console.log(`function winProb(evalPawns: number): number {`);
console.log(`  const cp = evalPawns * 100;`);
console.log(`  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);`);
console.log(`}\n`);
console.log(`function computeCAPS2(bestEval: number, afterEval: number): number {`);
console.log(`  const wd = Math.max(0, winProb(bestEval) - winProb(afterEval));`);
console.log(`  const threshold = ${threshold.toFixed(1)};`);
console.log(`  if (wd <= threshold) return 100;`);
console.log(`  const adj = wd - threshold;`);
console.log(`  return Math.max(0, Math.min(100, 100 * Math.exp(-${k.toFixed(3)} * Math.pow(adj, ${p.toFixed(2)}))));`);
console.log(`}`);
