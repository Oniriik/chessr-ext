// Mirrors maia2/utils.py:create_elo_dict / map_to_category.
// 11 buckets: <1100, 1100-1199, 1200-1299, ..., 1900-1999, >=2000

const START = 1100;
const END   = 2000;
const STEP  = 100;

export function eloBucketIndex(elo) {
  if (elo < START) return 0;
  if (elo >= END)  return ((END - START) / STEP) + 1;  // = 10
  return Math.floor((elo - START) / STEP) + 1;
}

export function bucketLabel(idx) {
  if (idx === 0) return `<${START}`;
  const total = (END - START) / STEP + 1; // 10
  if (idx === total) return `≥${END}`;
  const lo = START + (idx - 1) * STEP;
  return `${lo}-${lo + STEP - 1}`;
}

export const NUM_BUCKETS = (END - START) / STEP + 2; // 11
