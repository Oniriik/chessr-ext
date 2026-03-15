import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStreamerPort } from './useStreamerPort';
import { StreamerBoard } from './StreamerBoard';
import { StreamerSidebar } from './StreamerSidebar';
import { Wifi, WifiOff, Settings, ArrowLeft, Puzzle } from 'lucide-react';
import { useGameStore } from '../stores/gameStore';
import { usePuzzleStore } from '../stores/puzzleStore';
import { useAuthStore } from '../stores/authStore';
import { useSidebarStore } from '../stores/sidebarStore';
import { PlanBadge } from '../components/ui/plan-badge';
import { Button } from '../components/ui/button';

export function StreamerApp() {
  const { t } = useTranslation('common');
  const { isConnected } = useStreamerPort();
  const { isGameStarted, playerColor, currentTurn } = useGameStore();
  const { isStarted: isPuzzleStarted, playerColor: puzzlePlayerColor, isSolved: isPuzzleSolved } = usePuzzleStore();
  const { plan, planExpiry, initialize } = useAuthStore();
  const showSettings = useSidebarStore((s) => s.showSettings);
  const setShowSettings = useSidebarStore((s) => s.setShowSettings);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const isYourTurn = playerColor === currentTurn;

  return (
    <div id="chessr-root" className="tw-h-screen tw-bg-background tw-text-foreground tw-flex tw-flex-col">
      {/* Header — logo, game status, settings, plan badge, connection */}
      <header className="tw-flex tw-items-center tw-gap-3 tw-px-4 lg:tw-px-5 tw-py-2 tw-border-b tw-border-border tw-bg-card tw-flex-shrink-0">
        {/* Left: logo + settings toggle */}
        <div className="tw-flex tw-items-center tw-gap-2">
          <img
            src={chrome.runtime.getURL('icons/icon48.png')}
            alt="Chessr"
            className="tw-w-6 tw-h-6"
          />
          <span className="tw-text-sm tw-font-semibold">Chessr</span>
          {showSettings ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(false)}
              className="tw-h-7 tw-w-7"
              title={t('back')}
            >
              <ArrowLeft className="tw-h-3.5 tw-w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSettings(true)}
              className="tw-h-7 tw-w-7"
              title={t('settings')}
            >
              <Settings className="tw-h-3.5 tw-w-3.5" />
            </Button>
          )}
          <PlanBadge plan={plan} expiry={planExpiry} compact />
        </div>

        {/* Center: game/puzzle status (compact) */}
        <div className="tw-flex-1 tw-flex tw-justify-center">
          {isGameStarted && playerColor ? (
            <div className="tw-flex tw-items-center tw-gap-3">
              <div className="tw-flex tw-items-center tw-gap-1.5">
                <div className={`tw-w-4 tw-h-4 tw-rounded-sm ${playerColor === 'white' ? 'tw-bg-white' : 'tw-bg-zinc-800'} tw-ring-1 tw-ring-border`} />
                <span className="tw-text-xs tw-text-muted-foreground">
                  {playerColor === 'white' ? t('white') : t('black')}
                </span>
              </div>
              <div className={`tw-flex tw-items-center tw-gap-1.5 tw-px-2.5 tw-py-1 tw-rounded-full tw-text-xs tw-font-medium ${
                isYourTurn
                  ? 'tw-bg-primary/15 tw-text-primary'
                  : 'tw-bg-muted tw-text-muted-foreground'
              }`}>
                <div className={`tw-w-1.5 tw-h-1.5 tw-rounded-full ${
                  isYourTurn ? 'tw-bg-primary tw-animate-pulse' : 'tw-bg-muted-foreground/50'
                }`} />
                {isYourTurn ? t('yourTurn') : t('opponentsTurn')}
              </div>
            </div>
          ) : isPuzzleStarted && !isGameStarted ? (
            <div className="tw-flex tw-items-center tw-gap-3">
              {puzzlePlayerColor && (
                <div className="tw-flex tw-items-center tw-gap-1.5">
                  <div className={`tw-w-4 tw-h-4 tw-rounded-sm ${puzzlePlayerColor === 'white' ? 'tw-bg-white' : 'tw-bg-zinc-800'} tw-ring-1 tw-ring-border`} />
                  <span className="tw-text-xs tw-text-muted-foreground">
                    {puzzlePlayerColor === 'white' ? t('white') : t('black')}
                  </span>
                </div>
              )}
              <div className={`tw-flex tw-items-center tw-gap-1.5 tw-px-2.5 tw-py-1 tw-rounded-full tw-text-xs tw-font-medium ${
                isPuzzleSolved
                  ? 'tw-bg-green-500/15 tw-text-green-500'
                  : 'tw-bg-purple-500/15 tw-text-purple-400'
              }`}>
                <Puzzle className="tw-w-3.5 tw-h-3.5" />
                {isPuzzleSolved ? t('puzzle') + ' ✓' : t('puzzle')}
              </div>
            </div>
          ) : (
            <span className="tw-text-xs tw-text-muted-foreground tw-bg-muted tw-px-2 tw-py-0.5 tw-rounded-full">
              Streamer Mode
            </span>
          )}
        </div>

        {/* Right: connection status */}
        <div className={`tw-flex tw-items-center tw-gap-1.5 tw-text-xs ${isConnected ? 'tw-text-green-400' : 'tw-text-muted-foreground'}`}>
          {isConnected ? <Wifi className="tw-w-3.5 tw-h-3.5" /> : <WifiOff className="tw-w-3.5 tw-h-3.5" />}
          <span className="tw-hidden sm:tw-inline">
            {isConnected
              ? isGameStarted ? 'Game in progress' : isPuzzleStarted ? 'Puzzle in progress' : 'Connected'
              : 'Waiting...'}
          </span>
        </div>
      </header>

      {/* Horizontal on wide screens (no scroll), vertical+scroll on narrow */}
      <main className="tw-flex tw-flex-col lg:tw-flex-row tw-flex-1 tw-min-h-0 tw-overflow-y-auto lg:tw-overflow-hidden">
        {/* Board */}
        <div className="tw-flex tw-items-center tw-justify-center tw-p-3 lg:tw-p-4 tw-flex-shrink-0 lg:tw-flex-1 lg:tw-min-h-0 lg:tw-min-w-0">
          <StreamerBoard />
        </div>

        {/* Sidebar */}
        <div className="tw-bg-card tw-overflow-y-auto tw-flex-shrink-0 tw-border-t lg:tw-border-t-0 lg:tw-border-l tw-border-border lg:tw-w-[370px] lg:tw-h-full">
          <StreamerSidebar />
        </div>
      </main>
    </div>
  );
}
