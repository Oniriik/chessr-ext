/**
 * Maia 3 ONNX inference wrapper (server-side).
 *
 * Single InferenceSession shared across all jobs. ORT's intra-op thread pool
 * already parallelises the matmul workload internally, and `session.run()`
 * is reentrant from JS — concurrent calls just serialise at the C++ layer.
 *
 * For the (rare) case where we want to scale beyond one session: bump
 * MAX_MAIA3_SESSIONS in compose and spin a Maia3Pool wrapper. For now,
 * 1 session × small concurrency at the BullMQ worker level is sufficient.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = path.join(__dirname, '../../engines/onnx/maia3.onnx');

let session: ort.InferenceSession | null = null;
let initPromise: Promise<void> | null = null;

export interface Maia3RawOutput {
  logitsMove: Float32Array;
  logitsValue: Float32Array;
}

export async function initMaia3Session(modelPath?: string): Promise<void> {
  if (session) return;
  if (initPromise) return initPromise;

  const file = modelPath || process.env.MAIA3_MODEL_PATH || DEFAULT_MODEL;
  initPromise = (async () => {
    console.log(`[Maia3] loading ONNX session from ${file}`);
    const t0 = Date.now();
    // graphOptimizationLevel='extended' is the highest that works on this
    // model — 'all' (default) hits an optimizer pass that segfaults.
    session = await ort.InferenceSession.create(file, {
      graphOptimizationLevel: 'extended',
    });
    console.log(`[Maia3] session ready (${Date.now() - t0}ms)`);
  })();
  return initPromise;
}

/** Run inference for a single FEN (already mirrored to white-to-move).
 *  Returns the raw policy + LDW logits. Caller is responsible for masking
 *  by legal moves and softmax. */
export async function runMaia3(
  tokens: Float32Array,           // length 64*12
  eloSelf: number,
  eloOppo: number,
): Promise<Maia3RawOutput> {
  if (!session) throw new Error('Maia3 session not initialised');

  const feeds: Record<string, ort.Tensor> = {
    tokens:   new ort.Tensor('float32', tokens, [1, 64, 12]),
    elo_self: new ort.Tensor('float32', new Float32Array([eloSelf]), [1]),
    elo_oppo: new ort.Tensor('float32', new Float32Array([eloOppo]), [1]),
  };
  const result = await session.run(feeds);
  return {
    logitsMove:  result.logits_move.data as Float32Array,
    logitsValue: result.logits_value.data as Float32Array,
  };
}

export async function shutdownMaia3Session(): Promise<void> {
  if (session) {
    await session.release();
    session = null;
    initPromise = null;
  }
}
