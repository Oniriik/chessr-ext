import { NewAccuracyCache } from '../../domain/analysis/feedback-types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

interface NewAccuracyWidgetProps {
  cache: NewAccuracyCache;
}

export function NewAccuracyWidget({ cache }: NewAccuracyWidgetProps) {
  const TrendIcon = cache.accuracyTrend === 'up' ? TrendingUp : cache.accuracyTrend === 'down' ? TrendingDown : Minus;
  const trendColor = cache.accuracyTrend === 'up' ? 'tw-text-green-400' : cache.accuracyTrend === 'down' ? 'tw-text-red-400' : 'tw-text-gray-400';

  // Color based on accuracy
  const getAccuracyColor = (acc: number) => {
    if (acc >= 90) return 'tw-text-green-400';
    if (acc >= 80) return 'tw-text-blue-400';
    if (acc >= 70) return 'tw-text-yellow-400';
    if (acc >= 60) return 'tw-text-orange-400';
    return 'tw-text-red-400';
  };

  const totalMoves = cache.moveAnalyses.length;

  return (
    <div className="tw-p-3 tw-rounded-md tw-border tw-border-border tw-bg-background">
      {/* Header */}
      <div className="tw-text-xs tw-text-muted tw-mb-2">
        Game Statistics
      </div>

      {/* Main accuracy score */}
      <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className={cn('tw-text-2xl tw-font-bold', getAccuracyColor(cache.accuracy))}>
            {Math.round(cache.accuracy)}
          </span>
          {cache.accuracyTrend !== 'stable' && <TrendIcon className={cn('tw-w-5 tw-h-5', trendColor)} />}
        </div>

        <div className="tw-text-xs tw-text-muted">
          {totalMoves} analyzed
        </div>
      </div>

      {/* Summary breakdown - 3x3 grid (Chess.com advanced notation) */}
      <div className="tw-grid tw-grid-cols-3 tw-gap-1.5 tw-text-xs">
        {/* Row 1: Brilliant, Great, Best */}
        <div className="tw-text-center">
          <div className="tw-text-cyan-400 tw-font-semibold">{cache.summary.brilliant}</div>
          <div className="tw-text-muted tw-text-[10px]">!!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-green-500 tw-font-semibold">{cache.summary.great}</div>
          <div className="tw-text-muted tw-text-[10px]">!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-green-400 tw-font-semibold">{cache.summary.best}</div>
          <div className="tw-text-muted tw-text-[10px]">Best</div>
        </div>

        {/* Row 2: Excellent, Good, Book */}
        <div className="tw-text-center">
          <div className="tw-text-blue-400 tw-font-semibold">{cache.summary.excellent}</div>
          <div className="tw-text-muted tw-text-[10px]">Exc</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-blue-300 tw-font-semibold">{cache.summary.good}</div>
          <div className="tw-text-muted tw-text-[10px]">Good</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-purple-400 tw-font-semibold">{cache.summary.book}</div>
          <div className="tw-text-muted tw-text-[10px]">Book</div>
        </div>

        {/* Row 3: Inaccuracy, Mistake, Blunder */}
        <div className="tw-text-center">
          <div className="tw-text-yellow-400 tw-font-semibold">{cache.summary.inaccuracies}</div>
          <div className="tw-text-muted tw-text-[10px]">?!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-orange-400 tw-font-semibold">{cache.summary.mistakes}</div>
          <div className="tw-text-muted tw-text-[10px]">?</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-red-400 tw-font-semibold">{cache.summary.blunders}</div>
          <div className="tw-text-muted tw-text-[10px]">??</div>
        </div>
      </div>

      {/* Phase stats */}
      {totalMoves > 0 && (
        <div className="tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
          <div className="tw-grid tw-grid-cols-3 tw-gap-2 tw-text-center">
            {(['opening', 'middlegame', 'endgame'] as const).map((phase) => {
              const stats = cache.phaseStats[phase];
              if (stats.moves === 0) return null;
              return (
                <div key={phase} className="tw-flex tw-flex-col">
                  <span className="tw-text-[10px] tw-text-muted tw-capitalize">{phase}</span>
                  <span className={cn('tw-text-sm tw-font-medium', stats.accuracy !== null ? getAccuracyColor(stats.accuracy) : '')}>
                    {stats.accuracy !== null ? Math.round(stats.accuracy) : '-'}
                  </span>
                  <span className="tw-text-[10px] tw-text-muted">{stats.moves} moves</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
