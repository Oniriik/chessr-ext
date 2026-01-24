import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Clock, Layers, RefreshCw, RotateCcw, LogOut, Settings2 } from 'lucide-react';
import { useAppStore } from '../store/app.store';
import { useAuthStore } from '../store/auth.store';
import { useTranslation } from '../../i18n';
import { cn } from '../lib/utils';
import { Card, CardTitle } from './ui/card';
import { Accordion } from './ui/accordion';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Slider } from './ui/slider';
import { Select } from './ui/select';
import { OpeningSelector } from './OpeningSelector';
import { SettingsModal } from './SettingsModal';

// Mode configurations with minimum ELO requirements only
const PLAY_MODES_CONFIG = {
  safe: { minElo: 0 },
  balanced: { minElo: 0 },
  blitz: { minElo: 800 },
  positional: { minElo: 1000 },
  aggressive: { minElo: 2000 },
  tactical: { minElo: 2200 },
} as const;

type PlayMode = keyof typeof PLAY_MODES_CONFIG;

// Get available modes based on current ELO
function getAvailableModes(elo: number): PlayMode[] {
  return (Object.entries(PLAY_MODES_CONFIG) as [PlayMode, typeof PLAY_MODES_CONFIG[PlayMode]][])
    .filter(([_, config]) => elo >= config.minElo)
    .map(([key]) => key);
}

// Convert UCI Elo to approximate Chess.com Elo
// More linear at low ELOs, gradually inflating at higher levels
function uciToChesscom(uciElo: number): number {
  if (uciElo <= 400) return Math.round(uciElo * 1.1);         // 300 UCI ≈ 330 Chess.com
  if (uciElo <= 800) return Math.round(uciElo * 1.15 + 20);   // 800 UCI ≈ 940 Chess.com
  if (uciElo <= 1200) return Math.round(uciElo * 1.2 + 50);   // 1200 UCI ≈ 1490 Chess.com
  if (uciElo <= 1600) return Math.round(uciElo * 1.15 + 100); // 1600 UCI ≈ 1940 Chess.com
  if (uciElo <= 2000) return Math.round(uciElo * 1.1 + 100);  // 2000 UCI ≈ 2300 Chess.com
  if (uciElo <= 2400) return Math.round(uciElo * 1.05 + 50);  // 2400 UCI ≈ 2570 Chess.com
  return Math.round(uciElo + 50); // 2800+ UCI ≈ 2850 Chess.com
}

export function Sidebar() {
  const { settings, setSettings: setSettingsBase, connected, analysis, sidebarOpen, toggleSidebar, boardConfig, togglePlayerColor, redetectPlayerColor, eloOffset } = useAppStore();
  const { user, signOut } = useAuthStore();
  const { t } = useTranslation();

  // Wrapper to include userId for cloud sync
  const setSettings = (partial: Partial<typeof settings>) => {
    setSettingsBase(partial, user?.id);
  };

  // Get play modes with translations
  const getPlayModeInfo = (mode: PlayMode) => {
    const modeTranslations = {
      safe: t.modes.safe,
      balanced: t.modes.balanced,
      blitz: t.modes.blitz,
      positional: t.modes.positional,
      aggressive: t.modes.aggressive,
      tactical: t.modes.tactical,
    };
    return {
      ...modeTranslations[mode],
      minElo: PLAY_MODES_CONFIG[mode].minElo,
    };
  };

  // Local state for ELO slider with debounce
  const [localElo, setLocalElo] = useState(settings.targetElo);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Sync local ELO when settings change externally
  useEffect(() => {
    setLocalElo(settings.targetElo);
  }, [settings.targetElo]);

  // Reset mode to valid one if current mode is no longer available at this ELO
  useEffect(() => {
    const availableModes = getAvailableModes(localElo);
    if (!availableModes.includes(settings.mode as PlayMode)) {
      // Switch to the highest available mode
      const newMode = availableModes[availableModes.length - 1] || 'balanced';
      setSettings({ mode: newMode });
    }
  }, [localElo, settings.mode]);

  const handleEloChange = (value: number) => {
    setLocalElo(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSettings({ targetElo: value });
    }, 300);
  };

  const effectiveElo = settings.eloRandomization ? localElo + eloOffset : localElo;

  const evalValue = analysis?.mate !== undefined
    ? `${t.analysis.mateIn} ${Math.abs(analysis.mate)}`
    : analysis?.evaluation !== undefined
      ? (analysis.evaluation >= 0 ? '+' : '') + analysis.evaluation.toFixed(1)
      : '--';

  const evalColor = analysis?.mate !== undefined
    ? (analysis.mate > 0 ? 'tw-text-green-400' : 'tw-text-red-400')
    : (analysis?.evaluation ?? 0) >= 0 ? 'tw-text-green-400' : 'tw-text-red-400';

  return (
    <div className="tw-fixed tw-right-0 tw-top-0 tw-h-screen tw-z-[10000] tw-flex tw-font-sans tw-select-none" style={sidebarOpen ? { boxShadow: '-8px 0 30px rgba(0, 0, 0, 0.5), -2px 0 10px rgba(59, 130, 246, 0.1)' } : undefined}>
      {/* Toggle button - always visible on the left side */}
      <Button
        variant="outline"
        size="icon"
        onClick={toggleSidebar}
        className="tw-self-start tw-mt-4 !tw-bg-card tw-text-foreground tw-p-3 tw-rounded-l-lg tw-rounded-r-none tw-shadow-lg hover:!tw-bg-accent tw-border tw-border-r-0 tw-border-border tw-h-auto"
      >
        {sidebarOpen ? <ChevronRight className="tw-w-5 tw-h-5" /> : <ChevronLeft className="tw-w-5 tw-h-5" />}
      </Button>

      {/* Sidebar content - conditionally rendered */}
      {sidebarOpen && (
        <div className="tw-w-72 tw-bg-background tw-text-foreground tw-flex tw-flex-col tw-h-full">
          {/* Header */}
          <div className="tw-p-4 tw-border-b tw-border-border">
            <div className="tw-flex tw-items-center tw-justify-between tw-mb-2">
              <div className="tw-flex tw-items-center tw-gap-2">
                <div className={cn('tw-w-2.5 tw-h-2.5 tw-rounded-full', connected ? 'tw-bg-success' : 'tw-bg-danger')} />
                <span className="tw-font-semibold tw-text-sm">chessr.io</span>
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="tw-text-muted hover:tw-text-foreground tw-transition-colors tw-p-1"
                  title="Settings"
                >
                  <Settings2 className="tw-w-4 tw-h-4" />
                </button>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => setSettings({ enabled: checked })}
              />
            </div>
            {user && (
              <div className="tw-flex tw-items-center tw-justify-between tw-text-xs">
                <span className="tw-text-muted tw-truncate tw-max-w-[180px]">{user.email}</span>
                <button
                  onClick={signOut}
                  className="tw-text-muted hover:tw-text-foreground tw-flex tw-items-center tw-gap-1"
                >
                  <LogOut className="tw-w-3 tw-h-3" />
                </button>
              </div>
            )}
          </div>

      {/* Content */}
      <div className="tw-flex-1 tw-overflow-y-auto tw-p-4 tw-space-y-4">
        {/* Player Color */}
        <Card>
          <div className="tw-flex tw-items-center tw-justify-between tw-mb-2">
            <div>
              <div className="tw-text-xs tw-text-muted tw-mb-1">{t.player.title}</div>
              <div className="tw-text-lg tw-font-bold">
                {boardConfig?.playerColor === 'white' ? t.player.white : t.player.black}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={togglePlayerColor}>
              <RefreshCw className="tw-w-4 tw-h-4 tw-mr-1" /> {t.player.switch}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="tw-w-full" onClick={redetectPlayerColor}>
            <RotateCcw className="tw-w-4 tw-h-4 tw-mr-1" /> {t.player.redetect}
          </Button>
        </Card>

        {/* Analysis */}
        <Card>
          <div className="tw-grid tw-grid-cols-3 tw-gap-3">
            <div className="tw-text-center">
              <div className="tw-text-xs tw-text-muted tw-mb-1">{t.analysis.eval}</div>
              <div className={cn('tw-text-lg tw-font-bold', evalColor)}>{evalValue}</div>
            </div>
            <div className="tw-text-center">
              <div className="tw-text-xs tw-text-muted tw-mb-1">{t.analysis.centipawns}</div>
              <div className={cn('tw-text-lg tw-font-bold', evalColor)}>
                {analysis?.mate !== undefined
                  ? `${t.analysis.mateIn} ${Math.abs(analysis.mate)}`
                  : analysis?.evaluation !== undefined
                    ? `${analysis.evaluation >= 0 ? '+' : ''}${Math.round(analysis.evaluation * 100)}`
                    : '--'}
              </div>
            </div>
            <div className="tw-text-center">
              <div className="tw-text-xs tw-text-muted tw-mb-1">{t.analysis.move}</div>
              <div className="tw-text-lg tw-font-bold tw-text-primary">{analysis?.bestMove || '--'}</div>
            </div>
          </div>
          {analysis?.depth && (
            <div className="tw-text-center tw-text-xs tw-text-muted tw-mt-2">
              {t.analysis.depth}: {analysis.depth}
            </div>
          )}
        </Card>

        {/* Opening Selector */}
        <OpeningSelector />

        {/* ELO */}
        <Card>
          <CardTitle>{t.elo.title}</CardTitle>
          <div className="tw-flex tw-items-baseline tw-gap-2 tw-mb-1">
            <div className="tw-text-3xl tw-font-bold tw-text-primary">
              {settings.eloRandomization ? effectiveElo : localElo}
            </div>
            <div className="tw-text-sm tw-text-muted">UCI</div>
          </div>
          <div className="tw-text-sm tw-text-muted tw-mb-3">
            {t.elo.display}: <span className="tw-text-foreground tw-font-semibold">{uciToChesscom(effectiveElo)}</span>
          </div>
          <Slider
            value={localElo}
            onValueChange={handleEloChange}
            min={300}
            max={3000}
            step={50}
          />
          <div className="tw-flex tw-items-center tw-justify-between tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
            <div>
              <p className="tw-text-xs tw-text-muted">{t.elo.antiCheat}</p>
            </div>
            <Switch
              checked={settings.eloRandomization}
              onCheckedChange={(checked) => setSettings({ eloRandomization: checked })}
            />
          </div>
        </Card>

        {/* Mode */}
        <Card>
          <CardTitle>{t.modes.title}</CardTitle>
          <Select
            value={settings.mode}
            onValueChange={(value) => setSettings({ mode: value as PlayMode })}
            options={getAvailableModes(localElo).map((mode) => ({
              value: mode,
              label: getPlayModeInfo(mode).label,
            }))}
          />
          <p className="tw-text-xs tw-text-muted tw-mt-2">
            {getPlayModeInfo(settings.mode as PlayMode).description}
          </p>
        </Card>

        {/* Analyse Accordion */}
        <Accordion title={t.engine.title}>
          <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
            <span className="tw-text-2xl tw-font-bold tw-text-primary">
              {settings.searchMode === 'time' ? `${(settings.moveTime / 1000).toFixed(1)}s` : `D${settings.depth}`}
            </span>
            <span className="tw-text-xs tw-text-muted">
              {settings.searchMode === 'time' ? t.engine.timePerMove : t.engine.depth}
            </span>
          </div>
          <Slider
            value={settings.searchMode === 'time' ? settings.moveTime : settings.depth}
            onValueChange={(value) => {
              setSettings(settings.searchMode === 'time' ? { moveTime: value } : { depth: value });
            }}
            min={settings.searchMode === 'time' ? 200 : 8}
            max={settings.searchMode === 'time' ? 5000 : 30}
            step={settings.searchMode === 'time' ? 100 : 1}
          />
          <div className="tw-grid tw-grid-cols-2 tw-gap-2 tw-mt-3">
            <Button
              variant={settings.searchMode === 'time' ? 'default' : 'outline'}
              onClick={() => setSettings({ searchMode: 'time' })}
            >
              <Clock className="tw-w-4 tw-h-4" /> {t.engine.timePerMove}
            </Button>
            <Button
              variant={settings.searchMode === 'depth' ? 'default' : 'outline'}
              onClick={() => setSettings({ searchMode: 'depth' })}
            >
              <Layers className="tw-w-4 tw-h-4" /> {t.engine.depth}
            </Button>
          </div>
        </Accordion>
        </div>
      </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
