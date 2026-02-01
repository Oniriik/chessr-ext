import { AccuracyPayload, AccuracyCache } from '../../domain/analysis/feedback-types';
import { computeAccuracyTrend, buildAccuracyFromCache } from '../../domain/analysis/feedback-helpers';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '../lib/utils';

interface AccuracyWidgetProps {
  accuracy: AccuracyPayload;
  previousAccuracy?: AccuracyPayload;
  accuracyCache?: AccuracyCache;
  playerColor?: 'w' | 'b';
}

export function AccuracyWidget({ accuracy, previousAccuracy, accuracyCache, playerColor }: AccuracyWidgetProps) {
  // DEBUG: Log inputs
  console.log('[AccuracyWidget] Props:', {
    playerColor,
    hasCache: !!accuracyCache,
    cacheSize: accuracyCache?.analyzedPlies?.size,
    serverAccuracy: accuracy?.overall,
    serverOverall: accuracyCache?.serverOverall,
    initialCp: accuracyCache?.initialCp,
  });

  // Build accuracy from cache if available, filtered by player color
  // This calculates accuracy only for the player's moves from the entire cache
  //
  // IMPORTANT: If playerColor is not specified, we should NOT recalculate for all moves
  // because that would include both players' moves. Instead, use the server's overall
  // which was calculated correctly with the playerColor filter.
  let gameStats: AccuracyPayload;

  if (accuracyCache && playerColor) {
    // Player color known: recalculate from full cache for player's moves only
    gameStats = buildAccuracyFromCache(accuracyCache, playerColor);
  } else if (accuracyCache && accuracyCache.serverOverall !== undefined) {
    // Player color unknown but server already calculated: use server's value
    // (server calculated with playerColor from request)
    console.log('[AccuracyWidget] Using server overall (playerColor not specified):', accuracyCache.serverOverall);
    gameStats = buildAccuracyFromCache(accuracyCache, undefined);
    // Override with server's player-specific overall
    gameStats = { ...gameStats, overall: accuracyCache.serverOverall };
  } else {
    // Fallback to passed accuracy payload
    gameStats = accuracy;
  }

  // DEBUG: Log result
  console.log('[AccuracyWidget] Result:', {
    gameStatsOverall: gameStats?.overall,
    analyzedPlies: gameStats?.window?.analyzedPlies,
    method: accuracyCache ? (playerColor ? 'cache+color' : 'cache+serverOverall') : 'passed',
  });

  const trend = computeAccuracyTrend(previousAccuracy, gameStats);

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
        Game Statistics
      </div>

      {/* Main accuracy score */}
      <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className={cn('tw-text-2xl tw-font-bold', getAccuracyColor(gameStats.overall))}>
            {gameStats.overall}
          </span>
          {trend !== 'none' && <TrendIcon className={cn('tw-w-5 tw-h-5', trendColor)} />}
        </div>

        <div className="tw-text-xs tw-text-muted">
          {gameStats.window.analyzedPlies} analyzed
        </div>
      </div>

      {/* Summary breakdown - 3x3 grid (Chess.com advanced notation) */}
      {/* Shows summary of all analyzed moves */}
      <div className="tw-grid tw-grid-cols-3 tw-gap-1.5 tw-text-xs">
        {/* Row 1: Brilliant, Great, Best */}
        <div className="tw-text-center">
          <div className="tw-text-cyan-400 tw-font-semibold">{gameStats.summary.brilliant}</div>
          <div className="tw-text-muted tw-text-[10px]">!!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-green-500 tw-font-semibold">{gameStats.summary.great}</div>
          <div className="tw-text-muted tw-text-[10px]">!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-green-400 tw-font-semibold">{gameStats.summary.best}</div>
          <div className="tw-text-muted tw-text-[10px]">Best</div>
        </div>

        {/* Row 2: Excellent, Good, Book */}
        <div className="tw-text-center">
          <div className="tw-text-blue-400 tw-font-semibold">{gameStats.summary.excellent}</div>
          <div className="tw-text-muted tw-text-[10px]">Exc</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-blue-300 tw-font-semibold">{gameStats.summary.good}</div>
          <div className="tw-text-muted tw-text-[10px]">Good</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-purple-400 tw-font-semibold">{gameStats.summary.book}</div>
          <div className="tw-text-muted tw-text-[10px]">Book</div>
        </div>

        {/* Row 3: Inaccuracy, Mistake, Blunder */}
        <div className="tw-text-center">
          <div className="tw-text-yellow-400 tw-font-semibold">{gameStats.summary.inaccuracies}</div>
          <div className="tw-text-muted tw-text-[10px]">?!</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-orange-400 tw-font-semibold">{gameStats.summary.mistakes}</div>
          <div className="tw-text-muted tw-text-[10px]">?</div>
        </div>
        <div className="tw-text-center">
          <div className="tw-text-red-400 tw-font-semibold">{gameStats.summary.blunders}</div>
          <div className="tw-text-muted tw-text-[10px]">??</div>
        </div>
      </div>
    </div>
  );
}
