/**
 * BullMQ queue for Maia 3 ONNX predictions (server fallback).
 *
 * Producer = WS handler `maia3_request`, worker = single ORT session
 * (Maia3Session). Returns {fen, positionEval, suggestions} in the same
 * shape as the Maia 2 queue so the client ServerEngine handler stays
 * engine-agnostic.
 *
 * Maia 3 differences vs Maia 2:
 *   - 4352-dim policy (vs 1880)
 *   - Value head outputs LDW logits (loss/draw/win), softmax → win prob
 *   - ELO is a continuous float (no bucketing)
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import { Chess } from 'chess.js';
import { redis } from './connection.js';
import { initMaia3Session, runMaia3, shutdownMaia3Session } from '../engine/Maia3Session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 4352 UCI strings (same dict the extension uses)
const MOVES_DICT: Record<string, number> = JSON.parse(
  readFileSync(path.join(__dirname, '../engine/maia3_moves.json'), 'utf8'),
);
const MOVES_REVERSED_RAW: Record<string, string> = JSON.parse(
  readFileSync(path.join(__dirname, '../engine/maia3_moves_reversed.json'), 'utf8'),
);
const POLICY_SIZE = 4352;
const MOVES_REVERSED: string[] = new Array(POLICY_SIZE);
for (const k in MOVES_REVERSED_RAW) MOVES_REVERSED[Number(k)] = MOVES_REVERSED_RAW[k];

// ─── Job types ─────────────────────────────────────────────────────────

export interface Maia3JobData {
  requestId: string;
  userId: string;
  fen: string;
  /** Raw ELO floats (no bucketing — Maia 3 takes continuous ELO). */
  eloSelf: number;
  eloOppo: number;
  multiPv: number;
}

export interface Maia3Suggestion {
  multipv: number;
  move: string;
  evaluation: number;
  depth: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
  mateScore: number | null;
  pv: string[];
}

export interface Maia3JobResult {
  fen: string;
  positionEval: number;
  suggestions: Maia3Suggestion[];
}

// ─── Tuning ────────────────────────────────────────────────────────────

const QUEUE_NAME = 'maia-3';
const PRODUCER_TIMEOUT_MS = 15_000;
const LOCK_DURATION_MS = 30_000;

export const maia3Queue = new Queue<Maia3JobData, Maia3JobResult>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 100 },
    attempts: 1,
  },
});

let queueEvents: QueueEvents | null = null;
let worker: Worker<Maia3JobData, Maia3JobResult> | null = null;

// ─── Helpers (mirror upstream tensor.ts) ───────────────────────────────

function mirrorSquare(sq: string): string {
  return sq[0] + (9 - parseInt(sq[1], 10));
}
function mirrorMove(uci: string): string {
  const promo = uci.length > 4 ? uci.slice(4) : '';
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}
function swapColorsInRank(rank: string): string {
  let out = '';
  for (const c of rank) {
    if (/[A-Z]/.test(c)) out += c.toLowerCase();
    else if (/[a-z]/.test(c)) out += c.toUpperCase();
    else out += c;
  }
  return out;
}
function swapCastlingRights(c: string): string {
  if (c === '-') return '-';
  const r = new Set(c.split(''));
  const s = new Set<string>();
  if (r.has('K')) s.add('k');
  if (r.has('Q')) s.add('q');
  if (r.has('k')) s.add('K');
  if (r.has('q')) s.add('Q');
  let o = '';
  for (const ch of ['K', 'Q', 'k', 'q']) if (s.has(ch)) o += ch;
  return o || '-';
}
function mirrorFEN(fen: string): string {
  const [pos, color, castling, ep, half, full] = fen.split(' ');
  const ranks = pos.split('/').slice().reverse().map(swapColorsInRank);
  return [
    ranks.join('/'),
    color === 'w' ? 'b' : 'w',
    swapCastlingRights(castling),
    ep !== '-' ? mirrorSquare(ep) : '-',
    half, full,
  ].join(' ');
}
function boardToTokens(fen: string): Float32Array {
  const piecePlacement = fen.split(' ')[0];
  const pieceTypes = ['P','N','B','R','Q','K','p','n','b','r','q','k'];
  const tensor = new Float32Array(64 * 12);
  const rows = piecePlacement.split('/');
  for (let rank = 0; rank < 8; rank++) {
    const row = 7 - rank;
    let file = 0;
    for (const ch of rows[rank]) {
      const n = parseInt(ch, 10);
      if (Number.isNaN(n)) {
        const idx = pieceTypes.indexOf(ch);
        if (idx >= 0) tensor[(row * 8 + file) * 12 + idx] = 1.0;
        file += 1;
      } else {
        file += n;
      }
    }
  }
  return tensor;
}

function winProbToCp(p: number): number {
  const c = Math.max(1e-4, Math.min(1 - 1e-4, p));
  return Math.max(-2000, Math.min(2000, Math.round(-400 * Math.log10((1 - c) / c))));
}

// ─── Worker ────────────────────────────────────────────────────────────

async function processMaia3Job(job: Job<Maia3JobData, Maia3JobResult>): Promise<Maia3JobResult> {
  const { fen, eloSelf, eloOppo, multiPv } = job.data;
  const isBlackToMove = fen.split(' ')[1] === 'b';
  const fenInModelFrame = isBlackToMove ? mirrorFEN(fen) : fen;

  const tokens = boardToTokens(fenInModelFrame);
  const { logitsMove, logitsValue } = await runMaia3(tokens, eloSelf, eloOppo);

  // LDW softmax → win prob
  const m = Math.max(logitsValue[0], logitsValue[1], logitsValue[2]);
  const eL = Math.exp(logitsValue[0] - m);
  const eD = Math.exp(logitsValue[1] - m);
  const eW = Math.exp(logitsValue[2] - m);
  const sumLDW = eL + eD + eW;
  let winProb = (eW + 0.5 * eD) / sumLDW;
  if (isBlackToMove) winProb = 1 - winProb;
  const positionEval = winProbToCp(winProb);

  // Legal-move mask in model frame
  const board = new Chess(fenInModelFrame);
  const legalIndices: number[] = [];
  for (const mv of board.moves({ verbose: true })) {
    const uci = mv.from + mv.to + ((mv as { promotion?: string }).promotion || '');
    const idx = MOVES_DICT[uci];
    if (idx !== undefined) legalIndices.push(idx);
  }

  if (legalIndices.length === 0) {
    return { fen, positionEval, suggestions: [] };
  }

  // Softmax over legal moves only
  const legalLogits = legalIndices.map((i) => logitsMove[i]);
  const lmax = Math.max(...legalLogits);
  const expL = legalLogits.map((l) => Math.exp(l - lmax));
  const sumE = expL.reduce((a, b) => a + b, 0) || 1;

  const ranked = legalIndices
    .map((origIdx, i) => ({
      uci: isBlackToMove ? mirrorMove(MOVES_REVERSED[origIdx]) : MOVES_REVERSED[origIdx],
      prob: expL[i] / sumE,
    }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, Math.max(1, Math.min(5, multiPv)));

  const suggestions: Maia3Suggestion[] = ranked.map((r, idx) => ({
    multipv: idx + 1,
    move: r.uci,
    evaluation: positionEval,
    depth: 0,
    winRate: r.prob * 100,
    drawRate: 0,
    lossRate: (1 - r.prob) * 100,
    mateScore: null,
    pv: [r.uci],
  }));

  return { fen, positionEval, suggestions };
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

export async function initMaia3Worker(concurrency: number): Promise<void> {
  if (worker) return;

  await initMaia3Session();

  queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis });
  await queueEvents.waitUntilReady();

  worker = new Worker<Maia3JobData, Maia3JobResult>(
    QUEUE_NAME,
    (job) => processMaia3Job(job),
    {
      connection: redis,
      concurrency,
      lockDuration: LOCK_DURATION_MS,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[Maia3Queue] job ${job?.id} failed:`, err.message);
  });
  console.log(`[Maia3Queue] worker ready (concurrency=${concurrency})`);
}

export async function enqueueMaia3(data: Maia3JobData): Promise<Maia3JobResult> {
  if (!queueEvents) throw new Error('Maia3Queue not initialised');
  const jobId = `maia3:${data.userId}:${data.requestId}`;
  const job = await maia3Queue.add('process', data, { jobId });
  return job.waitUntilFinished(queueEvents, PRODUCER_TIMEOUT_MS);
}

export async function removePendingMaia3ForUser(userId: string): Promise<number> {
  const waiting = await maia3Queue.getWaiting(0, 100);
  let removed = 0;
  for (const job of waiting) {
    if (job.data.userId === userId) {
      try { await job.remove(); removed++; } catch { /* ignore race with worker pickup */ }
    }
  }
  return removed;
}

export async function shutdownMaia3Worker(): Promise<void> {
  if (worker) { await worker.close(); worker = null; }
  if (queueEvents) { await queueEvents.close(); queueEvents = null; }
  await shutdownMaia3Session();
}
