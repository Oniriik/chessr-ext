import type { Job } from 'bullmq';
import { startSuggestionWorker, type SuggestionJob, type SuggestionResult } from '../lib/suggestionQueue.js';
import { sendToClient } from '../routes/ws.js';
import { EnginePool } from './pool.js';
import { getEngineConfig } from './config.js';
import { labelSuggestions } from './labeler.js';
import { logEnd } from '../lib/wsLog.js';

const pool = new EnginePool(2);

async function process(job: Job<SuggestionJob>): Promise<SuggestionResult> {
  const { requestId, userId, fen, moves, targetElo, personality, multiPv, limitStrength, search } = job.data;

  const engine = await pool.acquire();
  if (!engine) {
    sendToClient(userId, { type: 'suggestion_error', requestId, error: 'No engine available' });
    logEnd(userId, requestId, 'suggestion', 'no-engine');
    throw new Error('No engine available');
  }

  try {
    await engine.configure(getEngineConfig({ targetElo, personality, multiPv, limitStrength }));
    const raw = await engine.search(fen, multiPv, { moves, search });
    const labeled = labelSuggestions(raw, fen);

    const result: SuggestionResult = {
      requestId,
      fen,
      suggestions: labeled.map(s => ({
        move: s.move,
        evaluation: s.evaluation,
        winRate: s.winRate,
        drawRate: s.drawRate,
        lossRate: s.lossRate,
        depth: s.depth,
        mateScore: s.mateScore,
        pv: s.pv,
        labels: s.labels,
      })),
    };

    sendToClient(userId, { type: 'suggestion_result', ...result });
    const topDepth = labeled[0]?.depth ?? 0;
    logEnd(userId, requestId, 'suggestion', `d${topDepth} n=${labeled.length}`);
    return result;
  } finally {
    pool.release(engine);
  }
}

export async function startEngine() {
  await pool.init();
  const worker = startSuggestionWorker(process);
  console.log('[Engine] Worker ready');
  return worker;
}
