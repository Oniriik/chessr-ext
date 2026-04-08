import { useTranslation } from 'react-i18next';
import { Gamepad2, RefreshCw, Keyboard, Settings } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { useGameStore } from '../../stores/gameStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSidebarStore } from '../../stores/sidebarStore';

interface PieceIndicatorProps {
  color: 'white' | 'black';
  isActive?: boolean;
  size?: 'sm' | 'md';
}

function PieceIndicator({ color, isActive = false, size = 'md' }: PieceIndicatorProps) {
  const sizeClass = size === 'sm' ? 'tw-w-5 tw-h-5' : 'tw-w-6 tw-h-6';
  const bgColor = color === 'white'
    ? 'tw-bg-white'
    : 'tw-bg-zinc-800';
  const ringClass = isActive
    ? 'tw-ring-2 tw-ring-primary tw-ring-offset-1 tw-ring-offset-background'
    : 'tw-ring-1 tw-ring-border';

  return (
    <div
      className={`${sizeClass} ${bgColor} ${ringClass} tw-rounded-sm tw-transition-all tw-duration-200`}
    />
  );
}

export function GameStatusCard() {
  const { t } = useTranslation('common');
  const { isGameStarted, playerColor, currentTurn, redetect } = useGameStore();
  const hotkeyMoveEnabled = useSettingsStore((s) => s.hotkeyMoveEnabled);
  const openSettingsTab = useSidebarStore((s) => s.openSettingsTab);

  // Waiting state - friendly and minimal
  if (!isGameStarted) {
    return (
      <Card className="tw-bg-muted/30 tw-border-dashed">
        <CardContent className="tw-py-4 tw-px-4">
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-primary/10">
              <Gamepad2 className="tw-w-5 tw-h-5 tw-text-primary" />
            </div>
            <div className="tw-text-left">
              <p className="tw-text-sm tw-font-medium tw-text-foreground">
                {t('readyToPlay')}
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('startGameToSeeAnalysis')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Active game state - compact horizontal layout
  const isYourTurn = playerColor === currentTurn;

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-py-3 tw-px-4">
        <div className="tw-flex tw-items-center tw-justify-between">
          {/* Your color with refresh button */}
          <div className="tw-flex tw-items-center tw-gap-2.5">
            <button
              onClick={redetect}
              className="tw-relative tw-group tw-bg-transparent tw-border-0 tw-p-0 tw-cursor-pointer"
              title={t('refreshDetection')}
            >
              <PieceIndicator
                color={playerColor || 'white'}
                isActive={isYourTurn}
              />
              <div className="tw-absolute tw-inset-0 tw-flex tw-items-center tw-justify-center tw-bg-black/40 tw-rounded-sm tw-opacity-0 group-hover:tw-opacity-100 tw-transition-opacity">
                <RefreshCw className="tw-w-3 tw-h-3 tw-text-white" />
              </div>
            </button>
            <div className="tw-leading-tight">
              <p className="tw-text-xs tw-text-muted-foreground">{t('youPlay')}</p>
              <p className="tw-text-sm tw-font-semibold">
                {playerColor === 'white' ? t('white') : t('black')}
              </p>
            </div>
          </div>

          {/* Turn indicator */}
          <div className={`tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-rounded-full tw-transition-colors ${
            isYourTurn
              ? 'tw-bg-primary/15 tw-text-primary'
              : 'tw-bg-muted tw-text-muted-foreground'
          }`}>
            <div className={`tw-w-2 tw-h-2 tw-rounded-full ${
              isYourTurn ? 'tw-bg-primary tw-animate-pulse' : 'tw-bg-muted-foreground/50'
            }`} />
            <span className="tw-text-xs tw-font-medium">
              {isYourTurn ? t('yourTurn') : t('opponentsTurn')}
            </span>
          </div>
        </div>

        {/* Hotkey move banner */}
        {!hotkeyMoveEnabled && (
          <button
            onClick={() => openSettingsTab('suggestions')}
            className="tw-mt-2.5 tw-w-full tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-rounded-md tw-bg-primary/10 tw-border-0 tw-cursor-pointer tw-text-left tw-transition-colors hover:tw-bg-primary/15"
          >
            <Keyboard className="tw-w-3.5 tw-h-3.5 tw-text-primary tw-flex-shrink-0" />
            <span className="tw-text-xs tw-text-primary tw-flex-1">
              {t('hotkeyMoveBanner')}
            </span>
            <Settings className="tw-w-3 tw-h-3 tw-text-primary/60" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}
