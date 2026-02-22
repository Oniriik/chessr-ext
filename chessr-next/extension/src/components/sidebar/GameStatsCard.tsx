import { useMemo } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
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

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 90) return 'tw-text-green-500';
  if (accuracy >= 70) return 'tw-text-yellow-500';
  if (accuracy >= 50) return 'tw-text-orange-500';
  return 'tw-text-red-400';
}

function TrendIcon({ trend }: { trend: AccuracyTrend }) {
  if (trend === 'up') {
    return <TrendingUp className="tw-w-6 tw-h-6 tw-text-green-500" />;
  }
  if (trend === 'down') {
    return <TrendingDown className="tw-w-6 tw-h-6 tw-text-red-400" />;
  }
  return <Minus className="tw-w-6 tw-h-6 tw-text-muted-foreground" />;
}

interface ClassificationItemProps {
  label: string;
  count: number;
  colorClass: string;
}

function ClassificationItem({ label, count, colorClass }: ClassificationItemProps) {
  return (
    <div className="tw-flex tw-flex-col tw-items-center">
      <span className={`tw-text-lg tw-font-bold ${colorClass}`}>{count}</span>
      <span className="tw-text-xs tw-text-muted-foreground">{label}</span>
    </div>
  );
}

// Mapping for display
const CLASSIFICATION_CONFIG: {
  key: MoveClassification | 'brilliant' | 'great' | 'book';
  label: string;
  colorClass: string;
}[] = [
  { key: 'brilliant' as never, label: '!!', colorClass: 'tw-text-cyan-400' },
  { key: 'great' as never, label: '!', colorClass: 'tw-text-cyan-400' },
  { key: 'best', label: 'Best', colorClass: 'tw-text-green-500' },
  { key: 'excellent', label: 'Exc', colorClass: 'tw-text-green-400' },
  { key: 'good', label: 'Good', colorClass: 'tw-text-white' },
  { key: 'book' as never, label: 'Book', colorClass: 'tw-text-yellow-500' },
  { key: 'inaccuracy', label: '?!', colorClass: 'tw-text-yellow-500' },
  { key: 'mistake', label: '?', colorClass: 'tw-text-yellow-500' },
  { key: 'blunder', label: '??', colorClass: 'tw-text-red-400' },
];

export function GameStatsCard() {
  const { isGameStarted } = useGameStore();
  const accuracy = useAccuracy();
  const trend = useAccuracyTrend();
  const moveAnalyses = useMoveAnalyses();
  const phaseStats = usePhaseStats();

  // Memoize classification counts to prevent re-renders
  const counts = useMemo(
    () => computeClassificationCounts(moveAnalyses),
    [moveAnalyses]
  );

  const moveCount = moveAnalyses.length;
  const isIdle = !isGameStarted;

  return (
    <Card className={`tw-bg-muted/50 tw-p-4 ${isIdle ? 'tw-opacity-50' : ''}`}>
      <CardContent>
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-mb-4">
          <span className="tw-text-sm tw-font-medium">Accuracy</span>
          <span className={`tw-text-xs ${isIdle ? 'tw-text-muted-foreground' : 'tw-text-primary tw-font-medium'}`}>
            {isIdle ? 'Waiting for game...' : `${moveCount} analyzed`}
          </span>
        </div>

        <div className="tw-flex tw-gap-4">
          {/* Accuracy display */}
          <div className="tw-flex tw-items-center tw-gap-2">
            <span className={`tw-text-5xl tw-font-bold ${isIdle ? 'tw-text-muted-foreground' : getAccuracyColor(accuracy)}`}>
              {isIdle ? '-' : Math.round(accuracy)}
            </span>
            {!isIdle && <TrendIcon trend={trend} />}
          </div>

          {/* Classification grid */}
          <div className="tw-flex-1 tw-grid tw-grid-cols-3 tw-gap-2">
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
                colorClass={isIdle ? 'tw-text-muted-foreground' : config.colorClass}
              />
            ))}
          </div>
        </div>

        {/* Phase stats (collapsible later) */}
        {!isIdle && moveCount > 0 && (
          <div className="tw-mt-4 tw-pt-3 tw-border-t tw-border-border">
            <div className="tw-grid tw-grid-cols-3 tw-gap-2 tw-text-center">
              {(['opening', 'middlegame', 'endgame'] as const).map((phase) => {
                const stats = phaseStats[phase];
                if (stats.moves === 0) return null;
                return (
                  <div key={phase} className="tw-flex tw-flex-col">
                    <span className="tw-text-xs tw-text-muted-foreground tw-capitalize">
                      {phase}
                    </span>
                    <span className={`tw-text-sm tw-font-medium ${stats.accuracy !== null ? getAccuracyColor(stats.accuracy) : ''}`}>
                      {stats.accuracy !== null ? Math.round(stats.accuracy) : '-'}
                    </span>
                    <span className="tw-text-xs tw-text-muted-foreground">
                      {stats.moves} moves
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
