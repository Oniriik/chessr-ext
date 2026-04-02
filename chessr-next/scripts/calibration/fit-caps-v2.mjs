/**
 * Fit CAPS2 v2 - with clipping threshold for "best" moves
 * Chess.com gives CAPS2=100 for all "best" moves (diff up to ~0.22)
 * So the formula likely has a dead zone: CAPS2=100 when diff < threshold, then decay
 */

const dataPoints = [
  // Game 2: King's Indian
  { diff: 0.00, caps2: 100, cls: 'best' },
  { diff: 0.09, caps2: 99.09, cls: 'excellent' },
  { diff: 0.14, caps2: 98.58, cls: 'excellent' },
  { diff: 0.32, caps2: 85.58, cls: 'good' },
  { diff: 0.38, caps2: 82.18, cls: 'good' },
  { diff: 0.63, caps2: 65.79, cls: 'inaccuracy' },
  { diff: 0.84, caps2: 54.08, cls: 'inaccuracy' },
  { diff: 2.14, caps2: 7.77, cls: 'mistake' },
  { diff: 3.20, caps2: 0, cls: 'mistake' },
  // Game 1: Slav Defense
  { diff: 0.02, caps2: 100, cls: 'best' },
  { diff: 0.10, caps2: 100, cls: 'best' },
  { diff: 0.13, caps2: 100, cls: 'best' },
  { diff: 0.19, caps2: 100, cls: 'best' },
  { diff: 0.22, caps2: 100, cls: 'best' },
];

// ─── Formula with dead zone ───
// if diff <= threshold: CAPS2 = 100
// else: CAPS2 = 100 * exp(-k * (diff - threshold)^p)

function capsFormula(diff, threshold, k, p) {
  if (diff <= threshold) return 100;
  const adjusted = diff - threshold;
  return Math.max(0, 100 * Math.exp(-k * Math.pow(adjusted, p)));
}

function mse(points, fn) {
  let sum = 0;
  for (const p of points) {
    sum += (fn(p.diff) - p.caps2) ** 2;
  }
  return sum / points.length;
}

// Grid search
let bestError = Infinity;
let bestParams = null;

for (let t = 0; t <= 0.30; t += 0.005) {
  for (let k = 0.3; k <= 5.0; k += 0.05) {
    for (let p = 0.5; p <= 3.0; p += 0.05) {
      const fn = (d) => capsFormula(d, t, k, p);
      const err = mse(dataPoints, fn);
      if (err < bestError) {
        bestError = err;
        bestParams = { threshold: t, k, p };
      }
    }
  }
}

const { threshold, k, p } = bestParams;
console.log(`\nBest CAPS2 formula:`);
console.log(`  if diff <= ${threshold.toFixed(3)}: CAPS2 = 100`);
console.log(`  else: CAPS2 = 100 * exp(-${k.toFixed(2)} * (diff - ${threshold.toFixed(3)})^${p.toFixed(2)})`);
console.log(`  RMSE: ${Math.sqrt(bestError).toFixed(2)}\n`);

// Show predictions
console.log(`${'diff'.padEnd(6)} | ${'actual'.padEnd(8)} | ${'predicted'.padEnd(10)} | ${'error'.padEnd(8)} | class`);
console.log('-'.repeat(55));

for (const pt of dataPoints) {
  const pred = capsFormula(pt.diff, threshold, k, p);
  const err = (pred - pt.caps2).toFixed(1);
  console.log(`${pt.diff.toFixed(2).padEnd(6)} | ${pt.caps2.toFixed(1).padEnd(8)} | ${pred.toFixed(1).padEnd(10)} | ${err.padEnd(8)} | ${pt.cls}`);
}

// ─── Now determine classification thresholds ───
// From data: best has diff 0-0.22 (all 100 CAPS), but Chess.com Game 2 has
// "best" at diff=0 only, while game 1 has "best" at diff up to 0.22
// The key insight: "best" in game 1 are all BOOK moves!
// Non-book "best" in game 2 are diff=0
// So classification != CAPS2 threshold

console.log(`\n${'='.repeat(70)}`);
console.log('CLASSIFICATION ANALYSIS');
console.log(`${'='.repeat(70)}\n`);

// Filter only non-book classifications
const nonBook = dataPoints.filter(p => p.cls !== 'book');
const clsGroups = {};
for (const p of nonBook) {
  if (!clsGroups[p.cls]) clsGroups[p.cls] = [];
  clsGroups[p.cls].push(p.diff);
}

console.log('Non-book classification ranges:');
for (const [cls, diffs] of Object.entries(clsGroups).sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))) {
  console.log(`  ${cls.padEnd(14)}: diff [${Math.min(...diffs).toFixed(2)} - ${Math.max(...diffs).toFixed(2)}]  n=${diffs.length}`);
}

// From game 1, "best" moves with diff > 0 are actually book moves with caps2=100
// Real non-book best: diff=0.00 (exact best move)
// So the threshold for "best" is very low

// Proposed thresholds based on gaps in the data:
// best: 0 (only when played move == best move or diff ~0)
// excellent: diff ~0.05-0.25
// good: diff ~0.25-0.50
// inaccuracy: diff ~0.50-1.0
// mistake: diff ~1.0-3.0
// blunder: diff > 3.0

console.log('\n--- PROPOSED THRESHOLDS ---');

const thresholds = [
  ['best',       0.00, 0.05],
  ['excellent',  0.05, 0.25],
  ['good',       0.25, 0.50],
  ['inaccuracy', 0.50, 1.00],
  ['mistake',    1.00, 3.00],
  ['blunder',    3.00, Infinity],
];

for (const [cls, min, max] of thresholds) {
  const capsMin = capsFormula(max === Infinity ? 5 : max, threshold, k, p);
  const capsMax = capsFormula(min, threshold, k, p);
  console.log(`  ${cls.padEnd(14)}: diff (${min.toFixed(2)} - ${max === Infinity ? '∞' : max.toFixed(2)}]  →  CAPS2 [${capsMin.toFixed(0)} - ${capsMax.toFixed(0)}]`);
}

// ─── Final TypeScript output ───
console.log(`\n${'='.repeat(70)}`);
console.log('FINAL TYPESCRIPT CODE');
console.log(`${'='.repeat(70)}\n`);

console.log(`type MoveClassification = 'book' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'brilliant' | 'great';`);
console.log('');
console.log(`/**`);
console.log(` * Compute CAPS2 score from evaluation difference (in pawns)`);
console.log(` * Reverse-engineered from Chess.com analysis data`);
console.log(` * RMSE: ${Math.sqrt(bestError).toFixed(2)} on calibration set`);
console.log(` */`);
console.log(`function computeCAPS2(diff: number): number {`);
console.log(`  const threshold = ${threshold.toFixed(3)};`);
console.log(`  if (diff <= threshold) return 100;`);
console.log(`  const adjusted = diff - threshold;`);
console.log(`  return Math.max(0, Math.min(100, 100 * Math.exp(-${k.toFixed(2)} * Math.pow(adjusted, ${p.toFixed(2)}))));`);
console.log(`}\n`);

console.log(`/**`);
console.log(` * Classify move based on eval difference (in pawns)`);
console.log(` * difference = (bestEval - playedEval) normalized to player perspective`);
console.log(` */`);
console.log(`function classifyMove(diff: number): MoveClassification {`);
console.log(`  if (diff <= 0.05) return 'best';`);
console.log(`  if (diff <= 0.25) return 'excellent';`);
console.log(`  if (diff <= 0.50) return 'good';`);
console.log(`  if (diff <= 1.00) return 'inaccuracy';`);
console.log(`  if (diff <= 3.00) return 'mistake';`);
console.log(`  return 'blunder';`);
console.log(`}`);
