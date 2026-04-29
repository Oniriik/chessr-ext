import type { PageContextAdapter } from './PageContextAdapter';
import { ChesscomPageAdapter } from './chesscomPageAdapter';
import { LichessPageAdapter } from './lichessPageAdapter';
import { WorldchessPageAdapter } from './worldchessPageAdapter';

export type { PageContextAdapter, ChessrPostMessage, HumanizeTiming, Color, GameEnd } from './PageContextAdapter';

const adapters: PageContextAdapter[] = [
  new ChesscomPageAdapter(),
  new LichessPageAdapter(),
  new WorldchessPageAdapter(),
];

export function pickPageAdapter(host: string): PageContextAdapter | null {
  return adapters.find((a) => a.matches(host)) ?? null;
}
