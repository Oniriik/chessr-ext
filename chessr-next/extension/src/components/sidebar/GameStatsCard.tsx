import { useMemo } from 'react';
import { TrendingDown, TrendingUp, Minus, Lock } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { useGameStore } from '../../stores/gameStore';
import {
  useAccuracy,
  useAccuracyTrend,
  useMoveAnalyses,
  usePhaseStats,
  computeClassificationCounts,
  type AccuracyTrend,
  type MoveClassification,
} from '../../stores/accuracyStore';
import { usePlanLimits } from '../../lib/planUtils';

// Coherent color palette: emerald (good) → sky (ok) → amber (warning) → rose (bad)
function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 90) return 'tw-text-emerald-400';
  if (accuracy >= 70) return 'tw-text-sky-400';
  if (accuracy >= 50) return 'tw-text-amber-400';
  return 'tw-text-rose-400';
}

function getAccuracyBg(accuracy: number): string {
  if (accuracy >= 90) return 'tw-bg-emerald-500/10 tw-ring-1 tw-ring-emerald-500/20';
  if (accuracy >= 70) return 'tw-bg-sky-500/10 tw-ring-1 tw-ring-sky-500/20';
  if (accuracy >= 50) return 'tw-bg-amber-500/10 tw-ring-1 tw-ring-amber-500/20';
  return 'tw-bg-rose-500/10 tw-ring-1 tw-ring-rose-500/20';
}

function TrendIcon({ trend }: { trend: AccuracyTrend }) {
  if (trend === 'up') {
    return <TrendingUp className="tw-w-3.5 tw-h-3.5 tw-text-emerald-400" />;
  }
  if (trend === 'down') {
    return <TrendingDown className="tw-w-3.5 tw-h-3.5 tw-text-rose-400" />;
  }
  return <Minus className="tw-w-3.5 tw-h-3.5 tw-text-muted-foreground" />;
}

interface ClassificationItemProps {
  label: string;
  count: number;
  colorClass: string;
}

function ClassificationItem({ label, count, colorClass }: ClassificationItemProps) {
  const hasCount = count > 0;
  return (
    <div className={`tw-flex tw-flex-col tw-items-center tw-leading-tight tw-py-0.5 tw-rounded tw-transition-all ${hasCount ? 'tw-bg-muted/50' : ''}`}>
      <span className={`tw-text-sm tw-font-bold tw-tabular-nums tw-transition-colors ${colorClass}`}>{count}</span>
      <span className="tw-text-[10px] tw-text-muted-foreground">{label}</span>
    </div>
  );
}

// Mapping for display - coherent color palette
const CLASSIFICATION_CONFIG: {
  key: MoveClassification | 'brilliant' | 'great' | 'book';
  label: string;
  colorClass: string;
}[] = [
  { key: 'brilliant' as never, label: '!!', colorClass: 'tw-text-cyan-400' },
  { key: 'great' as never, label: '!', colorClass: 'tw-text-cyan-400' },
  { key: 'best', label: 'Best', colorClass: 'tw-text-emerald-400' },
  { key: 'excellent', label: 'Exc', colorClass: 'tw-text-emerald-300' },
  { key: 'good', label: 'Good', colorClass: 'tw-text-slate-200' },
  { key: 'book' as never, label: 'Book', colorClass: 'tw-text-violet-400' },
  { key: 'inaccuracy', label: '?!', colorClass: 'tw-text-amber-400' },
  { key: 'mistake', label: '?', colorClass: 'tw-text-orange-400' },
  { key: 'blunder', label: '??', colorClass: 'tw-text-rose-400' },
];

export function GameStatsCard() {
  const { isGameStarted } = useGameStore();
  const accuracy = useAccuracy();
  const trend = useAccuracyTrend();
  const moveAnalyses = useMoveAnalyses();
  const phaseStats = usePhaseStats();
  const { canSeePhaseAccuracy } = usePlanLimits();

  // Memoize classification counts to prevent re-renders
  const counts = useMemo(
    () => computeClassificationCounts(moveAnalyses),
    [moveAnalyses]
  );

  const moveCount = moveAnalyses.length;
  const isIdle = !isGameStarted;

  return (
    <Card className={`tw-bg-muted/50 tw-overflow-hidden ${isIdle ? 'tw-opacity-60' : ''}`}>
      <CardContent className="tw-p-3">
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
          <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted-foreground">Performance</span>
          <span className={`tw-text-[10px] ${isIdle ? 'tw-text-muted-foreground' : 'tw-text-primary/80'}`}>
            {isIdle ? 'Ready to track' : `${moveCount} moves`}
          </span>
        </div>

        <div className="tw-flex tw-gap-4 tw-items-center">
          {/* Accuracy display - focal point */}
          <div className={`tw-flex tw-flex-col tw-items-center tw-justify-center tw-px-4 tw-py-2 tw-rounded-xl tw-transition-all ${isIdle ? 'tw-bg-muted tw-ring-1 tw-ring-border' : getAccuracyBg(accuracy)}`}>
            <div className="tw-flex tw-items-baseline tw-gap-0.5">
              <span className={`tw-text-3xl tw-font-bold tw-tabular-nums ${isIdle ? 'tw-text-muted-foreground' : getAccuracyColor(accuracy)}`}>
                {isIdle ? '—' : Math.round(accuracy)}
              </span>
              {!isIdle && <span className={`tw-text-sm tw-font-medium ${getAccuracyColor(accuracy)}`}>%</span>}
            </div>
            {!isIdle && (
              <div className="tw-flex tw-items-center tw-gap-1 tw-mt-0.5">
                <TrendIcon trend={trend} />
                <span className="tw-text-[10px] tw-text-muted-foreground">
                  {trend === 'up' ? 'improving' : trend === 'down' ? 'declining' : 'stable'}
                </span>
              </div>
            )}
          </div>

          {/* Classification grid */}
          <div className="tw-flex-1 tw-grid tw-grid-cols-3 tw-gap-x-2 tw-gap-y-1.5">
            {CLASSIFICATION_CONFIG.map((config) => (
              <ClassificationItem
                key={config.key}
                label={config.label}
                count={
                  isIdle
                    ? 0
                    : config.key in counts
                      ? counts[config.key as MoveClassification]
                      : 0
                }
                colorClass={isIdle ? 'tw-text-muted-foreground/50' : config.colorClass}
              />
            ))}
          </div>
        </div>

        {/* Phase stats */}
        {!isIdle && moveCount > 0 && (
          <div className="tw-mt-2 tw-pt-2 tw-border-t tw-border-border">
            <span className="tw-text-[10px] tw-text-muted-foreground tw-block tw-mb-1">Accuracy by phase</span>
            <div className="tw-relative">
              {/* Actual or fake stats */}
              <div className={`tw-grid tw-grid-cols-3 tw-gap-1 tw-text-center ${!canSeePhaseAccuracy ? 'tw-blur-[3px] tw-select-none' : ''}`}>
                {(['opening', 'middlegame', 'endgame'] as const).map((phase) => {
                  const stats = phaseStats[phase];
                  // Show fake data for free users
                  const displayAccuracy = canSeePhaseAccuracy
                    ? (stats.accuracy !== null ? Math.round(stats.accuracy) : null)
                    : [87, 72, 91][['opening', 'middlegame', 'endgame'].indexOf(phase)];
                  const displayMoves = canSeePhaseAccuracy
                    ? stats.moves
                    : [8, 15, 6][['opening', 'middlegame', 'endgame'].indexOf(phase)];

                  if (canSeePhaseAccuracy && stats.moves === 0) return null;

                  return (
                    <div key={phase} className="tw-flex tw-flex-col tw-leading-tight">
                      <span className="tw-text-[10px] tw-text-muted-foreground tw-capitalize">
                        {phase}
                      </span>
                      <span className={`tw-text-xs tw-font-medium ${displayAccuracy !== null ? getAccuracyColor(displayAccuracy) : ''}`}>
                        {displayAccuracy !== null ? displayAccuracy : '-'}
                      </span>
                      <span className="tw-text-[10px] tw-text-muted-foreground">
                        {displayMoves} moves
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Unlock overlay */}
              {!canSeePhaseAccuracy && (
                <div className="tw-absolute tw-inset-0 tw-flex tw-items-center tw-justify-center">
                  <div className="tw-flex tw-items-center tw-gap-1.5 tw-px-2 tw-py-1 tw-rounded-full tw-bg-background/80 tw-backdrop-blur-sm tw-border tw-border-border">
                    <Lock className="tw-w-3 tw-h-3 tw-text-amber-400" />
                    <span className="tw-text-[10px] tw-font-medium">Unlock with Premium</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
