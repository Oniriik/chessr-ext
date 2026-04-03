/**
 * Re-fit CAPS2 formula using real Chess.com data from test-game-rating.mjs
 *
 * We know:
 * - `difference` field is NOT raw centipawns — it's some normalized metric
 * - Formula: if diff <= threshold: 100, else: 100 * exp(-k * (diff - threshold)^p)
 * - Need to find threshold, k, p that minimize error vs actual caps2
 */

// Real data points extracted from Chess.com analysis API
// Format: { diff, caps2, cls }
const dataPoints = [
  // Game 1: RatingHarvester (2511) vs specialyuta (200) — blitz
  // White (RatingHarvester) moves:
  { diff: 0.42, caps2: 92.5, cls: 'excellent' },
  { diff: 0.22, caps2: 96.1, cls: 'excellent' },
  { diff: 0.25, caps2: 95.4, cls: 'excellent' },
  { diff: 0.26, caps2: 95.4, cls: 'excellent' },
  { diff: 0.10, caps2: 98.2, cls: 'excellent' },
  { diff: 0.40, caps2: 93.8, cls: 'excellent' },
  { diff: 0.06, caps2: 99.1, cls: 'excellent' },
  { diff: 0.00, caps2: 100.0, cls: 'best' },
  { diff: 0.24, caps2: 95.4, cls: 'excellent' },
  { diff: 0.66, caps2: 88.4, cls: 'excellent' },
  { diff: 0.13, caps2: 93.0, cls: 'excellent' },
  { diff: 0.05, caps2: 97.6, cls: 'excellent' },
  { diff: 0.17, caps2: 89.8, cls: 'excellent' },
  { diff: 0.32, caps2: 79.2, cls: 'excellent' },
  { diff: 0.10, caps2: 93.1, cls: 'excellent' },
  { diff: 0.73, caps2: 61.4, cls: 'excellent' },
  { diff: 0.49, caps2: 71.6, cls: 'excellent' },
  { diff: 0.51, caps2: 75.1, cls: 'excellent' },
  { diff: 0.08, caps2: 94.4, cls: 'excellent' },
  { diff: 0.70, caps2: 63.4, cls: 'good' },
  { diff: 0.99, caps2: 55.4, cls: 'good' },
  { diff: 0.13, caps2: 94.6, cls: 'good' },
  { diff: 0.13, caps2: 94.5, cls: 'good' },
  { diff: 0.00, caps2: 100.0, cls: 'greatFind' },
  { diff: 0.65, caps2: 62.0, cls: 'good' },
];

console.log(`Data points: ${dataPoints.length}\n`);

// ─── Formula: CAPS2 = 100 * exp(-k * diff^p) ───
// No threshold/dead zone — Chess.com gives < 100 even for tiny diffs

function capsFormula(diff, k, p) {
  if (diff <= 0) return 100;
  return Math.max(0, 100 * Math.exp(-k * Math.pow(diff, p)));
}

function mse(points, fn) {
  let sum = 0;
  for (const pt of points) {
    sum += (fn(pt.diff) - pt.caps2) ** 2;
  }
  return sum / points.length;
}

// Grid search (no threshold — data shows caps2 < 100 even at diff=0.05)
let bestError = Infinity;
let bestParams = null;

for (let k = 0.01; k <= 2.0; k += 0.005) {
  for (let p = 0.3; p <= 3.0; p += 0.01) {
    const fn = (d) => capsFormula(d, k, p);
    const err = mse(dataPoints, fn);
    if (err < bestError) {
      bestError = err;
      bestParams = { k, p };
    }
  }
}

const { k, p } = bestParams;
console.log(`Best fit (no threshold):`);
console.log(`  CAPS2 = 100 * exp(-${k.toFixed(4)} * diff^${p.toFixed(4)})`);
console.log(`  RMSE: ${Math.sqrt(bestError).toFixed(2)}\n`);

// Also try WITH a small threshold
let bestError2 = Infinity;
let bestParams2 = null;

for (let t = 0; t <= 0.05; t += 0.001) {
  for (let k2 = 0.01; k2 <= 3.0; k2 += 0.01) {
    for (let p2 = 0.3; p2 <= 3.0; p2 += 0.01) {
      const fn = (d) => {
        if (d <= t) return 100;
        const adj = d - t;
        return Math.max(0, 100 * Math.exp(-k2 * Math.pow(adj, p2)));
      };
      const err = mse(dataPoints, fn);
      if (err < bestError2) {
        bestError2 = err;
        bestParams2 = { threshold: t, k: k2, p: p2 };
      }
    }
  }
}

console.log(`Best fit (with threshold):`);
console.log(`  if diff <= ${bestParams2.threshold.toFixed(3)}: CAPS2 = 100`);
console.log(`  else: CAPS2 = 100 * exp(-${bestParams2.k.toFixed(4)} * (diff - ${bestParams2.threshold.toFixed(3)})^${bestParams2.p.toFixed(4)})`);
console.log(`  RMSE: ${Math.sqrt(bestError2).toFixed(2)}\n`);

// Pick the better one
const useThreshold = bestError2 < bestError * 0.95; // only if significantly better
const finalFn = useThreshold
  ? (d) => {
      if (d <= bestParams2.threshold) return 100;
      const adj = d - bestParams2.threshold;
      return Math.max(0, 100 * Math.exp(-bestParams2.k * Math.pow(adj, bestParams2.p)));
    }
  : (d) => capsFormula(d, k, p);

const winnerLabel = useThreshold ? 'with threshold' : 'no threshold';
console.log(`Winner: ${winnerLabel}\n`);

// Show predictions
console.log(`${'diff'.padEnd(8)} | ${'actual'.padEnd(8)} | ${'predicted'.padEnd(10)} | ${'error'.padEnd(8)} | class`);
console.log('─'.repeat(60));

for (const pt of dataPoints) {
  const pred = finalFn(pt.diff);
  const err = (pred - pt.caps2).toFixed(1);
  console.log(
    `${pt.diff.toFixed(3).padEnd(8)} | ${pt.caps2.toFixed(1).padEnd(8)} | ${pred.toFixed(1).padEnd(10)} | ${err.padEnd(8)} | ${pt.cls}`
  );
}

// Final TypeScript
console.log(`\n${'═'.repeat(60)}`);
console.log('TYPESCRIPT CODE');
console.log(`${'═'.repeat(60)}\n`);

if (useThreshold) {
  const { threshold: t, k: k2, p: p2 } = bestParams2;
  console.log(`function computeCAPS2(difference: number): number {`);
  console.log(`  if (difference <= ${t.toFixed(3)}) return 100;`);
  console.log(`  const adj = difference - ${t.toFixed(3)};`);
  console.log(`  return Math.max(0, Math.min(100, 100 * Math.exp(-${k2.toFixed(4)} * Math.pow(adj, ${p2.toFixed(4)}))));`);
  console.log(`}`);
} else {
  console.log(`function computeCAPS2(difference: number): number {`);
  console.log(`  if (difference <= 0) return 100;`);
  console.log(`  return Math.max(0, Math.min(100, 100 * Math.exp(-${k.toFixed(4)} * Math.pow(difference, ${p.toFixed(4)}))));`);
  console.log(`}`);
}
