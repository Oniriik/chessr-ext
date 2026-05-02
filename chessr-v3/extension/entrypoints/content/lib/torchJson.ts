/**
 * Parsers + types for torch's `fetch analysis` JSON response.
 * Pure functions only — no Worker / browser API dependencies.
 *
 * Shape reference: see torch fetch_analysis fixtures under
 * __tests__/fixtures/. The full response is rich (themes, takeaways,
 * prediction, ...); we extract only the fields the chessr UI consumes
 * today.
 */

import { mapTorchClassification, type MoveClassification } from './torchClassification.js';

export interface CapsBlock {
  all: number;
  B: number; N: number; R: number; Q: number; K: number; P: number;
  gp0: number | null;
  gp1: number | null;
  gp2: number | null;
}

export interface TallyMap {
  best: number;
  brilliant: number;
  greatFind: number;
  excellent: number;
  good: number;
  book: number;
  forced: number;
  inaccuracy: number;
  mistake: number;
  miss: number;
  blunder: number;
}

export interface TorchMoveAnalysis {
  classification: MoveClassification;
  /** Pawns, ALWAYS from white's perspective (positive = white better).
   *  Verified empirically: after 1.e2e4, eval=+0.23 even though
   *  side-to-move-after=black. Don't negate this field per side-to-move. */
  evaluation: number;
  mateIn: number | null;
  arrows: string[];            // UCI moves to render as arrows
  squares: string[];           // squares to highlight
  speech: string | null;       // coaching sentence (joined)
  audioUrlHash: string | null; // for future voice-coach playback
  moveLan: string;             // UCI of the played move
}

export interface TorchAnalysis {
  moveAnalyses: TorchMoveAnalysis[];
  caps: { white: CapsBlock; black: CapsBlock };
  effectiveElo: { white: number; black: number };
  tallies: { white: TallyMap; black: TallyMap };
}

export function parseFetchAnalysisJson(raw: unknown): TorchAnalysis {
  if (!raw || typeof raw !== 'object') throw new Error('torch JSON: expected object');
  const obj = raw as Record<string, unknown>;
  const positions = (obj.positions ?? []) as Array<Record<string, unknown>>;
  // positions[0] is the starting position (no played move). Skip it.
  const moveAnalyses: TorchMoveAnalysis[] = positions.slice(1).map((p) => {
    const played = (p.playedMove ?? {}) as Record<string, any>;
    const evalObj = (played.eval ?? {}) as Record<string, any>;
    const speech0 = ((played.speech ?? []) as any[])[0] ?? {};
    return {
      classification: mapTorchClassification(p.classificationName as string | undefined),
      evaluation: typeof evalObj.cp === 'number' ? evalObj.cp / 100 : 0,
      mateIn: typeof played.mateIn === 'number' ? played.mateIn : null,
      arrows: Array.isArray(speech0.arrows) ? speech0.arrows : [],
      squares: Array.isArray(speech0.squares) ? speech0.squares : [],
      speech: Array.isArray(speech0.sentence) ? speech0.sentence.join('') : null,
      audioUrlHash: typeof speech0.audioUrlHash === 'string' ? speech0.audioUrlHash : null,
      moveLan: typeof played.moveLan === 'string' ? played.moveLan : '',
    };
  });

  const reportCard = (obj.reportCard ?? {}) as Record<string, any>;
  const caps = (obj.CAPS ?? {}) as Record<string, any>;
  const tallies = (obj.tallies ?? {}) as Record<string, any>;

  return {
    moveAnalyses,
    caps: {
      white: extractCapsBlock(caps.white),
      black: extractCapsBlock(caps.black),
    },
    effectiveElo: {
      white: numberOr(reportCard.white?.effectiveElo, 0),
      black: numberOr(reportCard.black?.effectiveElo, 0),
    },
    tallies: {
      white: extractTally(tallies.white),
      black: extractTally(tallies.black),
    },
  };
}

function extractCapsBlock(raw: any): CapsBlock {
  return {
    all: numberOr(raw?.all, 0),
    B: numberOr(raw?.B, 0), N: numberOr(raw?.N, 0), R: numberOr(raw?.R, 0),
    Q: numberOr(raw?.Q, 0), K: numberOr(raw?.K, 0), P: numberOr(raw?.P, 0),
    gp0: typeof raw?.gp0 === 'number' ? raw.gp0 : null,
    gp1: typeof raw?.gp1 === 'number' ? raw.gp1 : null,
    gp2: typeof raw?.gp2 === 'number' ? raw.gp2 : null,
  };
}

function extractTally(raw: any): TallyMap {
  return {
    best: numberOr(raw?.best, 0),
    brilliant: numberOr(raw?.brilliant, 0),
    greatFind: numberOr(raw?.greatFind, 0),
    excellent: numberOr(raw?.excellent, 0),
    good: numberOr(raw?.good, 0),
    book: numberOr(raw?.book, 0),
    forced: numberOr(raw?.forced, 0),
    inaccuracy: numberOr(raw?.inaccuracy, 0),
    mistake: numberOr(raw?.mistake, 0),
    miss: numberOr(raw?.miss, 0),
    blunder: numberOr(raw?.blunder, 0),
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
