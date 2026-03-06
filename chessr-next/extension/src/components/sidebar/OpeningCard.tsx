/**
 * OpeningCard - Displays current opening info and book moves
 */

import { useTranslation } from 'react-i18next';
import { BookOpen, BookX, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useOpeningStore } from '../../stores/openingStore';
import { useGameStore } from '../../stores/gameStore';
import type { BookMove } from '../../lib/openingBook';

interface WinRateBarProps {
  whiteWinRate: number;
  drawRate: number;
  blackWinRate: number;
}

function WinRateBar({ whiteWinRate, drawRate, blackWinRate }: WinRateBarProps) {
  return (
    <div className="tw-flex tw-h-2 tw-rounded-full tw-overflow-hidden tw-bg-muted">
      <div
        className="tw-bg-white tw-border-r tw-border-border/30"
        style={{ width: `${whiteWinRate}%` }}
      />
      <div
        className="tw-bg-zinc-400"
        style={{ width: `${drawRate}%` }}
      />
      <div
        className="tw-bg-zinc-800"
        style={{ width: `${blackWinRate}%` }}
      />
    </div>
  );
}

interface BookMoveRowProps {
  move: BookMove;
  rank: number;
  playerColor: 'white' | 'black' | null;
}

function BookMoveRow({ move, rank, playerColor }: BookMoveRowProps) {
  const winRateForPlayer = playerColor === 'black' ? move.blackWinRate : move.whiteWinRate;
  const winRateColor = winRateForPlayer >= 50
    ? 'tw-text-green-500'
    : winRateForPlayer >= 45
      ? 'tw-text-yellow-500'
      : 'tw-text-red-400';

  const formatGames = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return n.toString();
  };

  return (
    <div className="tw-space-y-1">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-text-muted-foreground tw-w-4">#{rank}</span>
          <span className="tw-font-mono tw-font-semibold">{move.san}</span>
        </div>
        <div className="tw-flex tw-items-center tw-gap-3 tw-text-xs">
          <span className={winRateColor}>{winRateForPlayer.toFixed(0)}%</span>
          <span className="tw-text-muted-foreground">({formatGames(move.totalGames)})</span>
        </div>
      </div>
      <WinRateBar
        whiteWinRate={move.whiteWinRate}
        drawRate={move.drawRate}
        blackWinRate={move.blackWinRate}
      />
    </div>
  );
}

export function OpeningCard() {
  const { t } = useTranslation(['game', 'common']);
  const { playerColor } = useGameStore();
  const {
    isInBook,
    openingName,
    eco,
    bookMoves,
    leftBookAtMove,
    isLoading,
    showOpeningCard,
    statsUnavailable,
  } = useOpeningStore();

  // Don't render if setting is disabled
  if (!showOpeningCard) {
    return null;
  }

  // Loading state
  if (isLoading) {
    return (
      <Card className="tw-bg-muted/50 tw-p-4">
        <CardContent>
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-py-2">
            <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin" />
            <span className="tw-text-sm tw-text-muted-foreground">{t('game:loadingOpeningData')}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Stats unavailable state (Lichess API failed)
  if (statsUnavailable) {
    return (
      <Card className="tw-bg-muted/50 tw-p-4">
        <CardHeader className="tw-p-0 tw-pb-2">
          <CardTitle className="tw-text-sm tw-flex tw-items-center tw-gap-2">
            <BookOpen className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
            <span>{t('game:openingBook')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-p-0">
          <p className="tw-text-xs tw-text-muted-foreground">
            Stats: <span className="tw-font-medium">{t('game:statsNA')}</span>
          </p>
        </CardContent>
      </Card>
    );
  }

  // Out of book state
  if (!isInBook && leftBookAtMove !== null) {
    return (
      <Card className="tw-bg-amber-500/10 tw-border-amber-500/30 tw-p-4">
        <CardHeader className="tw-p-0 tw-pb-2">
          <CardTitle className="tw-text-sm tw-flex tw-items-center tw-gap-2">
            <BookX className="tw-w-4 tw-h-4 tw-text-amber-500" />
            <span>{t('game:outOfBook')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-p-0">
          <p className="tw-text-xs tw-text-muted-foreground">
            {t('game:leftTheoryAtMove', { move: Math.ceil(leftBookAtMove / 2) })}
          </p>
        </CardContent>
      </Card>
    );
  }

  // In book state
  if (isInBook && bookMoves.length > 0) {
    return (
      <Card className="tw-bg-muted/50 tw-p-4">
        <CardHeader className="tw-p-0 tw-pb-3">
          <CardTitle className="tw-text-sm tw-flex tw-items-center tw-gap-2">
            <BookOpen className="tw-w-4 tw-h-4 tw-text-purple-500" />
            <span>{openingName ?? t('game:openingBook')}</span>
            {eco && (
              <span className="tw-text-xs tw-text-muted-foreground tw-font-normal">
                ({eco})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="tw-p-0">
          <div className="tw-space-y-3">
            {/* Legend */}
            <div className="tw-flex tw-items-center tw-justify-between tw-text-xs tw-text-muted-foreground">
              <span>{t('game:bookMoves')}</span>
              <div className="tw-flex tw-items-center tw-gap-2">
                <span className="tw-flex tw-items-center tw-gap-1">
                  <div className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-white tw-border tw-border-border/50" />
                  {t('common:white')}
                </span>
                <span className="tw-flex tw-items-center tw-gap-1">
                  <div className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-zinc-400" />
                  {t('common:draw')}
                </span>
                <span className="tw-flex tw-items-center tw-gap-1">
                  <div className="tw-w-2 tw-h-2 tw-rounded-full tw-bg-zinc-800" />
                  {t('common:black')}
                </span>
              </div>
            </div>

            {/* Book moves list */}
            <div className="tw-space-y-2">
              {bookMoves.slice(0, 5).map((move, index) => (
                <BookMoveRow
                  key={move.uci}
                  move={move}
                  rank={index + 1}
                  playerColor={playerColor}
                />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Default: no opening data yet
  return null;
}
