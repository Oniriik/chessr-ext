/**
 * StreamerSidebar - Sidebar for the streamer page.
 * Reuses existing sidebar subcomponents, but:
 * - No AuthGuard (data comes from relay, not direct WebSocket)
 * - No useGameDetection (game state comes from relay)
 * - No useArrowRenderer (arrows drawn by chessground)
 * - No useSuggestionTrigger (content script handles it)
 */

import { useTranslation } from 'react-i18next';
import { Puzzle, Lightbulb, Loader2, Play, CheckCircle2, Zap } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Switch } from '../components/ui/switch';
import { Slider } from '../components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { GameStatsCard } from '../components/sidebar/GameStatsCard';
import { MoveListDisplay } from '../components/sidebar/MoveListDisplay';
import { EloSettings } from '../components/sidebar/EloSettings';
import { MaiaSettings, MaiaConnectionCard } from '../components/sidebar/MaiaSettings';
import { OpeningRepertoireSelector } from '../components/sidebar/OpeningRepertoireSelector';
import { SettingsView } from '../components/sidebar/settings';
import { useEngineStore } from '../stores/engineStore';
import { useGameStore } from '../stores/gameStore';
import { usePuzzleStore, type PuzzleSearchMode, type PuzzleEngine } from '../stores/puzzleStore';
import { useSidebarStore } from '../stores/sidebarStore';

function EngineTabContent() {
  const { selectedEngine } = useEngineStore();

  return (
    <>
      {selectedEngine === 'maia2' ? (
        <>
          <MaiaSettings />
          <MaiaConnectionCard />
        </>
      ) : (
        <EloSettings />
      )}
      <OpeningRepertoireSelector />
    </>
  );
}

function formatMove(uciMove: string): string {
  if (uciMove.length < 4) return uciMove;
  const from = uciMove.slice(0, 2);
  const to = uciMove.slice(2, 4);
  const promotion = uciMove.length > 4 ? `=${uciMove[4].toUpperCase()}` : '';
  return `${from} → ${to}${promotion}`;
}

function StreamerPuzzleContent() {
  const { isStarted, isSolved, playerColor, suggestion, isLoading } = usePuzzleStore();
  const { t } = useTranslation(['puzzles', 'common', 'game']);

  if (isSolved) {
    return (
      <Card className="tw-bg-green-500/10 tw-border-green-500/30">
        <CardContent className="tw-py-4 tw-px-4">
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-green-500/20">
              <CheckCircle2 className="tw-w-5 tw-h-5 tw-text-green-500" />
            </div>
            <div className="tw-text-left">
              <p className="tw-text-sm tw-font-medium tw-text-green-500">
                {t('puzzles:puzzleSolved')}
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('puzzles:greatJob')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!isStarted) {
    return (
      <Card className="tw-bg-muted/30 tw-border-dashed">
        <CardContent className="tw-py-4 tw-px-4">
          <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
            <div className="tw-p-2 tw-rounded-lg tw-bg-primary/10">
              <Play className="tw-w-5 tw-h-5 tw-text-primary" />
            </div>
            <div className="tw-text-left">
              <p className="tw-text-sm tw-font-medium tw-text-foreground">
                {t('common:readyToPlay')}
              </p>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('puzzles:startPuzzle')}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const colorLabel = playerColor === 'white' ? t('common:white') : t('common:black');

  let badgeContent: React.ReactNode;
  let badgeStyle = 'tw-bg-primary/15 tw-text-primary';

  if (suggestion) {
    badgeContent = (
      <>
        <Lightbulb className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">{formatMove(suggestion.move)}</span>
      </>
    );
    badgeStyle = 'tw-bg-green-500/15 tw-text-green-500';
  } else if (isLoading) {
    badgeContent = (
      <>
        <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin" />
        <span className="tw-text-xs tw-font-medium">{t('game:analyzing')}</span>
      </>
    );
  } else {
    badgeContent = (
      <>
        <Puzzle className="tw-w-4 tw-h-4" />
        <span className="tw-text-xs tw-font-medium">{t('puzzles:waiting')}</span>
      </>
    );
  }

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-py-3 tw-px-4">
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-2.5">
            <div className={`tw-w-6 tw-h-6 tw-rounded-sm tw-ring-2 tw-ring-primary tw-ring-offset-1 tw-ring-offset-background ${
              playerColor === 'white' ? 'tw-bg-white' : 'tw-bg-zinc-800'
            }`} />
            <div className="tw-leading-tight">
              <p className="tw-text-xs tw-text-muted-foreground">{t('common:youPlay')}</p>
              <p className="tw-text-sm tw-font-semibold">{colorLabel}</p>
            </div>
          </div>
          <div className={`tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-1.5 tw-rounded-full ${badgeStyle}`}>
            {badgeContent}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatSearchValue(mode: PuzzleSearchMode, nodes: number, depth: number, movetime: number) {
  switch (mode) {
    case 'nodes': return nodes >= 1_000_000 ? `${(nodes / 1_000_000).toFixed(1)}M` : `${(nodes / 1000).toFixed(0)}k`;
    case 'depth': return `${depth}`;
    case 'movetime': return `${(movetime / 1000).toFixed(1)}s`;
  }
}

function StreamerPuzzleSettings() {
  const {
    autoHint, setAutoHint, autoPlay, setAutoPlay, isStarted,
    puzzleEngine, setPuzzleEngine,
    searchMode, setSearchMode, searchNodes, setSearchNodes,
    searchDepth, setSearchDepth, searchMovetime, setSearchMovetime,
  } = usePuzzleStore();
  const { t } = useTranslation(['puzzles', 'common', 'game', 'engine', 'settings']);

  const isMaia = puzzleEngine === 'maia2';

  if (!isStarted) return null;

  return (
    <Card className="tw-mt-3">
      <CardContent className="tw-py-3 tw-px-4 tw-space-y-3">
        {/* Engine selector */}
        <div className="tw-flex tw-items-center tw-justify-between">
          <span className="tw-text-sm tw-font-medium">{t('game:engine')}</span>
          <select
            value={puzzleEngine}
            onChange={(e) => setPuzzleEngine(e.target.value as PuzzleEngine)}
            className="tw-h-8 tw-px-3 tw-py-1 tw-text-xs tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer"
          >
            <option value="komodo">{t('puzzles:komodoDragon')}</option>
            <option value="maia2">{t('settings:maia2Local')}</option>
          </select>
        </div>

        {/* Auto hint toggle */}
        <div className="tw-flex tw-items-center tw-justify-between">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Lightbulb className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
            <span className="tw-text-sm tw-text-foreground">{t('puzzles:autoHint')}</span>
          </div>
          <Switch checked={autoHint} onCheckedChange={setAutoHint} />
        </div>

        {/* Auto play toggle */}
        {autoHint && (
          <div className="tw-flex tw-items-center tw-justify-between">
            <div className="tw-flex tw-items-center tw-gap-2">
              <Zap className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
              <span className="tw-text-sm tw-text-foreground">{t('puzzles:autoPlay')}</span>
            </div>
            <Switch checked={autoPlay} onCheckedChange={setAutoPlay} />
          </div>
        )}

        {/* Search mode (Komodo only) */}
        {!isMaia && (
          <div className="tw-space-y-2">
            <div className="tw-flex tw-items-center tw-justify-between">
              <select
                value={searchMode}
                onChange={(e) => setSearchMode(e.target.value as PuzzleSearchMode)}
                className="tw-h-7 tw-px-2 tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-text-xs"
              >
                <option value="nodes">{t('engine:nodes')}</option>
                <option value="depth">{t('engine:depth')}</option>
                <option value="movetime">{t('engine:moveTime')}</option>
              </select>
              <span className="tw-text-base tw-font-bold tw-text-primary">
                {formatSearchValue(searchMode, searchNodes, searchDepth, searchMovetime)}
              </span>
            </div>
            {searchMode === 'nodes' && (
              <Slider value={[searchNodes]} onValueChange={([v]) => setSearchNodes(v)} min={100000} max={5000000} step={100000} />
            )}
            {searchMode === 'depth' && (
              <Slider value={[searchDepth]} onValueChange={([v]) => setSearchDepth(v)} min={1} max={30} step={1} />
            )}
            {searchMode === 'movetime' && (
              <Slider value={[searchMovetime]} onValueChange={([v]) => setSearchMovetime(v)} min={500} max={5000} step={100} />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StreamerSidebar() {
  const { t } = useTranslation(['common', 'game']);
  const showSettings = useSidebarStore((s) => s.showSettings);
  const { isGameStarted } = useGameStore();
  const { isStarted: isPuzzleStarted } = usePuzzleStore();

  const isPuzzleMode = isPuzzleStarted && !isGameStarted;

  return (
    <div className="tw-h-full tw-flex tw-flex-col">
      <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-flex-col">
        {showSettings ? (
          <SettingsView />
        ) : isPuzzleMode ? (
          <div className="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden tw-space-y-4">
            <StreamerPuzzleContent />
            <StreamerPuzzleSettings />
          </div>
        ) : (
          <div className="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden tw-space-y-4">
            <Tabs defaultValue="game" className="tw-w-full tw-flex-1 tw-flex tw-flex-col tw-overflow-hidden">
              <TabsList className="tw-w-full tw-flex-shrink-0">
                <TabsTrigger value="game" className="tw-flex-1">{t('game:gameInfos')}</TabsTrigger>
                <TabsTrigger value="engine" className="tw-flex-1">{t('game:engine')}</TabsTrigger>
              </TabsList>
              <TabsContent value="game" className="tw-flex-1 tw-overflow-y-auto tw-space-y-4">
                <GameStatsCard />
                <MoveListDisplay />
              </TabsContent>
              <TabsContent value="engine" className="tw-flex-1 tw-overflow-y-auto tw-space-y-4">
                <EngineTabContent />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </Card>
    </div>
  );
}
