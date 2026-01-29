import { AccuracyPayload, AccuracyCache, Side } from '../../domain/analysis/feedback-types';
import { computeAccuracyTrend, buildAccuracyFromCache } from '../../domain/analysis/feedback-helpers';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

interface AccuracyWidgetProps {
  accuracy: AccuracyPayload;
  previousAccuracy?: AccuracyPayload;
  accuracyCache?: AccuracyCache;
  playerColor?: 'white' | 'black';
}

export function AccuracyWidget({ accuracy, previousAccuracy, accuracyCache, playerColor }: AccuracyWidgetProps) {
  // If cache and playerColor provided, rebuild accuracy with player-only filtering
  const displayAccuracy = accuracyCache && playerColor
    ? buildAccuracyFromCache(accuracyCache, playerColor === 'white' ? 'w' : 'b')
    : accuracy;

  const trend = computeAccuracyTrend(previousAccuracy, displayAccuracy);

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'tw-text-green-400' : trend === 'down' ? 'tw-text-red-400' : 'tw-text-gray-400';

  // Color based on accuracy
  const getAccuracyColor = (acc: number) => {
    if (acc >= 90) return 'tw-text-green-400';
    if (acc >= 80) return 'tw-text-blue-400';
    if (acc >= 70) return 'tw-text-yellow-400';
    if (acc >= 60) return 'tw-text-orange-400';
    return 'tw-text-red-400';
  };

  return (
    <div className="tw-p-3 tw-rounded-md tw-border tw-border-border tw-bg-background">
      {/* Header */}
      <div className="tw-text-xs tw-text-muted tw-mb-2">
        Rolling Accuracy (Last {displayAccuracy.window.lastMoves} moves)
      </div>

      {/* Main accuracy score */}
      <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className={cn('tw-text-2xl tw-font-bold', getAccuracyColor(displayAccuracy.overall))}>
            {displayAccuracy.overall}
          </span>
          {trend !== 'none' && <TrendIcon className={cn('tw-w-5 tw-h-5', trendColor)} />}
        </div>

        <div className="tw-text-xs tw-text-muted">
          {displayAccuracy.window.analyzedPlies} plies
        </div>
      </div>

      {/* Summary breakdown - 3x3 grid (Chess.com advanced notation) */}
      <div className="tw-grid tw-grid-cols-3 tw-gap-1.5 tw-text-xs">
        {/* Row 1: Brilliant, Great, Best */}
        <div className="tw-text-center">
          <div className="tw-text-cyan-400 tw-font-semibold">{displayAccuracy.summary.brilliant}</div>
          <div className="tw-text-muted tw-text-[10px]">!!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-green-500 tw-font-semibold">{displayAccuracy.summary.great}</div>
          <div className="tw-text-muted tw-text-[10px]">!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-green-400 tw-font-semibold">{displayAccuracy.summary.best}</div>
          <div className="tw-text-muted tw-text-[10px]">Best</div>
        </div>

        {/* Row 2: Excellent, Good, Book */}
        <div className="tw-text-center">
          <div className="tw-text-blue-400 tw-font-semibold">{displayAccuracy.summary.excellent}</div>
          <div className="tw-text-muted tw-text-[10px]">Exc</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-blue-300 tw-font-semibold">{displayAccuracy.summary.good}</div>
          <div className="tw-text-muted tw-text-[10px]">Good</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-purple-400 tw-font-semibold">{displayAccuracy.summary.book}</div>
          <div className="tw-text-muted tw-text-[10px]">Book</div>
        </div>

        {/* Row 3: Inaccuracy, Mistake, Blunder */}
        <div className="tw-text-center">
          <div className="tw-text-yellow-400 tw-font-semibold">{displayAccuracy.summary.inaccuracies}</div>
          <div className="tw-text-muted tw-text-[10px]">?!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-orange-400 tw-font-semibold">{displayAccuracy.summary.mistakes}</div>
          <div className="tw-text-muted tw-text-[10px]">?</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-red-400 tw-font-semibold">{displayAccuracy.summary.blunders}</div>
          <div className="tw-text-muted tw-text-[10px]">??</div>
        </div>
      </div>
    </div>
  );
}
