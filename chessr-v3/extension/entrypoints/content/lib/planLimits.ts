/**
 * enforceFreeTierLimits — clamp every premium-gated knob back into
 * free-tier bounds. Called when a plan downgrades under a live session
 * (trial expiring while the page is open) and after settings hydrate on
 * a non-premium account, so stale cloud-synced premium values (Maia
 * engine, Elo 2600, hotkey mode…) can't survive the downgrade until the
 * next page refresh.
 *
 * Free tier (mirrors the per-component gates in GameScreen / AutoMoveTab):
 *   - engines: Komodo + Stockfish only
 *   - target Elo: ≤ 2000, LimitStrength forced on (Force-depth is premium)
 *   - personalities: Default / Aggressive
 *   - dynamism / king safety: auto only
 *   - variety: locked at engine default (0)
 *   - auto-move: mode Off (hotkey / auto are premium)
 *
 * Goes through the store setters so the clamped values also cloud-sync.
 */

import { useEngineStore, type Personality, type EngineId } from '../stores/engineStore';
import { useAutoMoveStore } from '../stores/autoMoveStore';

const FREE_ENGINES: EngineId[] = ['komodo', 'stockfish'];
const FREE_PERSONALITIES: Personality[] = ['Default', 'Aggressive'];
const FREE_MAX_ELO = 2000;

export function enforceFreeTierLimits(): void {
  const e = useEngineStore.getState();
  if (!FREE_ENGINES.includes(e.engineId)) e.setEngineId('komodo');
  if (e.targetEloManual > FREE_MAX_ELO) e.setTargetEloManual(FREE_MAX_ELO);
  if (!e.limitStrength) e.setLimitStrength(true);
  if (!FREE_PERSONALITIES.includes(e.personality)) e.setPersonality('Default');
  if (!e.dynamismAuto) e.setDynamismAuto(true);
  if (!e.kingSafetyAuto) e.setKingSafetyAuto(true);
  if (e.variety !== 0) e.setVariety(0);
  if (e.forceServerEngine) e.setForceServerEngine(false);

  const am = useAutoMoveStore.getState();
  if (am.mode !== 'off') am.setMode('off');
}
