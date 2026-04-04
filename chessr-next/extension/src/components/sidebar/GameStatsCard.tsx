import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingDown, TrendingUp, Minus, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { useGameStore } from '../../stores/gameStore';
import { useBetaStore } from '../../stores/betaStore';
import { getRealHref } from '../../content/anonymousBlur';
import {
  useAccuracy,
  useAccuracyTrend,
  useMoveAnalyses,
  computeClassificationCounts,
  type AccuracyTrend,
  type MoveClassification,
} from '../../stores/accuracyStore';
import { useBoardContextStore } from '../../stores/boardContextStore';

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
  labelKey: string | null; // i18n key, null means use static symbol
  staticLabel: string | null; // static symbol (not translated)
  colorClass: string;
}[] = [
  { key: 'brilliant' as never, labelKey: null, staticLabel: '!!', colorClass: 'tw-text-cyan-400' },
  { key: 'great' as never, labelKey: null, staticLabel: '!', colorClass: 'tw-text-cyan-400' },
  { key: 'best', labelKey: 'statsBest', staticLabel: null, colorClass: 'tw-text-emerald-400' },
  { key: 'excellent', labelKey: 'statsExc', staticLabel: null, colorClass: 'tw-text-emerald-300' },
  { key: 'good', labelKey: 'statsGood', staticLabel: null, colorClass: 'tw-text-slate-200' },
  { key: 'book' as never, labelKey: 'statsBook', staticLabel: null, colorClass: 'tw-text-violet-400' },
  { key: 'inaccuracy', labelKey: null, staticLabel: '?!', colorClass: 'tw-text-amber-400' },
  { key: 'mistake', labelKey: null, staticLabel: '?', colorClass: 'tw-text-orange-400' },
  { key: 'blunder', labelKey: null, staticLabel: '??', colorClass: 'tw-text-rose-400' },
];

export function GameStatsCard() {
  const { t } = useTranslation(['game', 'common']);
  const { isGameStarted, chessInstance } = useGameStore();
  const accuracy = useAccuracy();
  const trend = useAccuracyTrend();
  const moveAnalyses = useMoveAnalyses();
  const hasChesscomUnlock = useBetaStore((s) => s.hasBeta('chesscomUnlock'));

  const boardGameOver = useBoardContextStore((s) => s.isGameOver);

  // Extract gameId from Chess.com URL (live/daily games only)
  const gameId = useMemo(() => {
    try {
      const url = new URL(getRealHref());
      const match = url.pathname.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGameStarted, chessInstance, boardGameOver]);
  const isGameOver = (!isGameStarted && moveAnalyses.length > 0)
    || !!chessInstance?.isGameOver()
    || !!document.querySelector('.game-review-emphasis-component')
    || boardGameOver;
  const isReviewPage = getRealHref().includes('/analysis/game/');
  const showUnlockButton = hasChesscomUnlock && gameId && (isGameOver || isReviewPage);

  // Memoize classification counts to prevent re-renders
  const counts = useMemo(
    () => computeClassificationCounts(moveAnalyses),
    [moveAnalyses]
  );

  const moveCount = moveAnalyses.length;
  const isIdle = !isGameStarted && !isGameOver;

  return (
    <Card className={`tw-bg-muted/50 tw-overflow-hidden ${isIdle ? 'tw-opacity-60' : ''}`}>
      <CardContent className="tw-p-3">
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
          <span className="tw-text-xs tw-font-semibold tw-uppercase tw-tracking-wide tw-text-muted-foreground">{t('game:performance')}</span>
          <span className={`tw-text-[10px] ${isIdle ? 'tw-text-muted-foreground' : 'tw-text-primary/80'}`}>
            {isIdle ? t('game:readyToTrack') : `${moveCount} ${t('common:moves')}`}
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
                  {trend === 'up' ? t('game:improving') : trend === 'down' ? t('game:declining') : t('game:stable')}
                </span>
              </div>
            )}
          </div>

          {/* Classification grid */}
          <div className="tw-flex-1 tw-grid tw-grid-cols-3 tw-gap-x-2 tw-gap-y-1.5">
            {CLASSIFICATION_CONFIG.map((config) => (
              <ClassificationItem
                key={config.key}
                label={config.labelKey ? t(`game:${config.labelKey}`) : config.staticLabel!}
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

        {/* Unlock Chess.com Analysis button (beta) */}
        {showUnlockButton && (
          <button
            onClick={() => window.open(`http://localhost:3002/review/${gameId}`, '_blank')}
            className="tw-mt-3 tw-w-full tw-flex tw-items-center tw-justify-center tw-gap-1.5 tw-px-3 tw-py-1.5 tw-rounded-lg tw-bg-emerald-500/15 tw-ring-1 tw-ring-emerald-500/30 tw-text-emerald-400 tw-text-xs tw-font-medium hover:tw-bg-emerald-500/25 tw-transition-all tw-cursor-pointer"
          >
            <ExternalLink className="tw-w-3.5 tw-h-3.5" />
            Unlock Chess.com Analysis
          </button>
        )}

      </CardContent>
    </Card>
  );
}

