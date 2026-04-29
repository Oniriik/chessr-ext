import type { PageContextAdapter } from './PageContextAdapter';
import { ChesscomPageAdapter } from './chesscomPageAdapter';
import { LichessPageAdapter } from './lichessPageAdapter';

export type { PageContextAdapter, ChessrPostMessage, HumanizeTiming, Color, GameEnd } from './PageContextAdapter';

const adapters: PageContextAdapter[] = [
  new ChesscomPageAdapter(),
  new LichessPageAdapter(),
];

export function pickPageAdapter(host: string): PageContextAdapter | null {
  return adapters.find((a) => a.matches(host)) ?? null;
}
