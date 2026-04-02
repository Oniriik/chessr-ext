/**
 * Fit CAPS2 formula from Chess.com data points
 * Also determine classification thresholds based on difference (in pawns)
 */

// All data points from both games
const dataPoints = [
  // Game 2: King's Indian (chessr-io vs judit-age6-BOT)
  { diff: 0.00, caps2: 100, cls: 'best' },
  { diff: 0.09, caps2: 99.09, cls: 'excellent' },
  { diff: 0.14, caps2: 98.58, cls: 'excellent' },
  { diff: 0.32, caps2: 85.58, cls: 'good' },
  { diff: 0.38, caps2: 82.18, cls: 'good' },
  { diff: 0.63, caps2: 65.79, cls: 'inaccuracy' },
  { diff: 0.84, caps2: 54.08, cls: 'inaccuracy' },
  { diff: 2.14, caps2: 7.77, cls: 'mistake' },
  { diff: 3.20, caps2: 0, cls: 'mistake' },

  // Game 1: Slav Defense (tanyer23 vs chessr-io) - non-book moves
  { diff: 0.02, caps2: 100, cls: 'best' },
  { diff: 0.10, caps2: 100, cls: 'best' },
  { diff: 0.13, caps2: 100, cls: 'best' },
  { diff: 0.19, caps2: 100, cls: 'best' },
  { diff: 0.22, caps2: 100, cls: 'best' },
];

// ─── Try different formulas ───

// Formula 1: CAPS2 = 100 * exp(-k * diff)
function formula1(diff, k) {
  return Math.max(0, 100 * Math.exp(-k * diff));
}

// Formula 2: CAPS2 = 100 * exp(-k * diff^p)
function formula2(diff, k, p) {
  return Math.max(0, 100 * Math.exp(-k * Math.pow(diff, p)));
}

// Formula 3: CAPS2 = max(0, 100 - a * diff^b)
function formula3(diff, a, b) {
  return Math.max(0, 100 - a * Math.pow(diff, b));
}

// Formula 4: CAPS2 = 100 / (1 + k * diff^p)  (sigmoid-like)
function formula4(diff, k, p) {
  return Math.max(0, 100 / (1 + k * Math.pow(diff, p)));
}

// ─── Least squares fitting ───

function mse(points, fn) {
  let sum = 0;
  for (const p of points) {
    const pred = fn(p.diff);
    sum += (pred - p.caps2) ** 2;
  }
  return sum / points.length;
}

// Brute force search for best parameters
function fitFormula(points, formulaFn, paramRanges) {
  let bestError = Infinity;
  let bestParams = null;

  function search(params, depth) {
    if (depth === paramRanges.length) {
      const fn = (diff) => formulaFn(diff, ...params);
      const err = mse(points, fn);
      if (err < bestError) {
        bestError = err;
        bestParams = [...params];
      }
      return;
    }

    const [min, max, step] = paramRanges[depth];
    for (let v = min; v <= max; v += step) {
      params[depth] = v;
      search(params, depth + 1);
    }
  }

  search([], 0);
  return { params: bestParams, mse: bestError, rmse: Math.sqrt(bestError) };
}

console.log('Fitting CAPS2 formulas to Chess.com data...\n');
console.log('Data points:');
for (const p of dataPoints) {
  console.log(`  diff=${p.diff.toFixed(2)} → CAPS2=${p.caps2.toFixed(2)} (${p.cls})`);
}

// Fit Formula 1: 100 * exp(-k * diff)
const fit1 = fitFormula(dataPoints, formula1, [[0.1, 5.0, 0.01]]);
console.log(`\nFormula 1: CAPS2 = 100 * exp(-${fit1.params[0].toFixed(2)} * diff)`);
console.log(`  RMSE: ${fit1.rmse.toFixed(2)}`);

// Fit Formula 2: 100 * exp(-k * diff^p)
const fit2 = fitFormula(dataPoints, formula2, [[0.1, 10.0, 0.05], [0.5, 3.0, 0.05]]);
console.log(`\nFormula 2: CAPS2 = 100 * exp(-${fit2.params[0].toFixed(2)} * diff^${fit2.params[1].toFixed(2)})`);
console.log(`  RMSE: ${fit2.rmse.toFixed(2)}`);

// Fit Formula 3: max(0, 100 - a * diff^b)
const fit3 = fitFormula(dataPoints, formula3, [[10, 200, 1], [0.5, 3.0, 0.05]]);
console.log(`\nFormula 3: CAPS2 = max(0, 100 - ${fit3.params[0]} * diff^${fit3.params[1].toFixed(2)})`);
console.log(`  RMSE: ${fit3.rmse.toFixed(2)}`);

// Fit Formula 4: 100 / (1 + k * diff^p)
const fit4 = fitFormula(dataPoints, formula4, [[0.1, 10.0, 0.05], [0.5, 4.0, 0.05]]);
console.log(`\nFormula 4: CAPS2 = 100 / (1 + ${fit4.params[0].toFixed(2)} * diff^${fit4.params[1].toFixed(2)})`);
console.log(`  RMSE: ${fit4.rmse.toFixed(2)}`);

// ─── Show best formula predictions ───
const bestFit = [fit1, fit2, fit3, fit4].sort((a, b) => a.rmse - b.rmse)[0];
const bestIdx = [fit1, fit2, fit3, fit4].indexOf(bestFit) + 1;
console.log(`\n${'='.repeat(80)}`);
console.log(`BEST FIT: Formula ${bestIdx} (RMSE=${bestFit.rmse.toFixed(2)})`);
console.log(`${'='.repeat(80)}\n`);

// Show all formulas predictions
console.log('Predictions comparison:');
console.log(`${'diff'.padEnd(6)} | ${'actual'.padEnd(8)} | ${'F1'.padEnd(8)} | ${'F2'.padEnd(8)} | ${'F3'.padEnd(8)} | ${'F4'.padEnd(8)} | class`);
console.log('-'.repeat(70));

for (const p of dataPoints) {
  const f1 = formula1(p.diff, ...fit1.params).toFixed(1);
  const f2 = formula2(p.diff, ...fit2.params).toFixed(1);
  const f3 = formula3(p.diff, ...fit3.params).toFixed(1);
  const f4 = formula4(p.diff, ...fit4.params).toFixed(1);
  console.log(`${p.diff.toFixed(2).padEnd(6)} | ${p.caps2.toFixed(1).padEnd(8)} | ${f1.padEnd(8)} | ${f2.padEnd(8)} | ${f3.padEnd(8)} | ${f4.padEnd(8)} | ${p.cls}`);
}

// ─── Classification thresholds ───
console.log(`\n${'='.repeat(80)}`);
console.log('CLASSIFICATION THRESHOLDS (based on difference in pawns)');
console.log(`${'='.repeat(80)}\n`);

// Group by classification
const clsGroups = {};
for (const p of dataPoints) {
  if (!clsGroups[p.cls]) clsGroups[p.cls] = [];
  clsGroups[p.cls].push(p.diff);
}

for (const [cls, diffs] of Object.entries(clsGroups).sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))) {
  console.log(`  ${cls.padEnd(14)}: diff ${Math.min(...diffs).toFixed(2)} - ${Math.max(...diffs).toFixed(2)}`);
}

console.log('\nProposed thresholds:');
console.log('  best:        diff <= 0.05');
console.log('  excellent:   diff <= 0.20');
console.log('  good:        diff <= 0.50');
console.log('  inaccuracy:  diff <= 1.00');
console.log('  mistake:     diff <= 2.50');
console.log('  blunder:     diff > 2.50');

// ─── Generate final TypeScript code ───
console.log(`\n${'='.repeat(80)}`);
console.log('PROPOSED TYPESCRIPT IMPLEMENTATION');
console.log(`${'='.repeat(80)}\n`);

// Use best formula
const formulas = {
  1: `100 * Math.exp(-${fit1.params[0].toFixed(2)} * diff)`,
  2: `100 * Math.exp(-${fit2.params[0].toFixed(2)} * Math.pow(diff, ${fit2.params[1].toFixed(2)}))`,
  3: `Math.max(0, 100 - ${fit3.params[0]} * Math.pow(diff, ${fit3.params[1].toFixed(2)}))`,
  4: `100 / (1 + ${fit4.params[0].toFixed(2)} * Math.pow(diff, ${fit4.params[1].toFixed(2)}))`,
};

console.log(`// CAPS2 score (Formula ${bestIdx})`);
console.log(`function computeCAPS2(diff: number): number {`);
console.log(`  return Math.max(0, Math.min(100, ${formulas[bestIdx]}));`);
console.log(`}\n`);

console.log(`// Classification based on difference (in pawns)`);
console.log(`function classifyMove(diff: number): string {`);
console.log(`  if (diff <= 0.05) return 'best';`);
console.log(`  if (diff <= 0.20) return 'excellent';`);
console.log(`  if (diff <= 0.50) return 'good';`);
console.log(`  if (diff <= 1.00) return 'inaccuracy';`);
console.log(`  if (diff <= 2.50) return 'mistake';`);
console.log(`  return 'blunder';`);
console.log(`}`);
