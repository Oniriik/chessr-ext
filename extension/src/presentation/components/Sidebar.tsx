import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, LogOut, Settings2, RotateCw } from 'lucide-react';
import { useAppStore } from '../store/app.store';
import { useFeedbackStore } from '../store/feedback.store';
import { useAuthStore } from '../store/auth.store';
import { useTranslation } from '../../i18n';
import { useIsRTL } from '../hooks/useIsRTL';
import { cn } from '../lib/utils';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Checkbox } from './ui/checkbox';
import { Slider } from './ui/slider';
import { Select } from './ui/select';
import { OpeningSelector } from './OpeningSelector';
import { SettingsModal } from './SettingsModal';
import { SuggestionCard } from './SuggestionCard';
import { NewAccuracyWidget } from './NewAccuracyWidget';

import { Personality, Settings } from '../../shared/types';
import { getRiskLabel, getSkillLabel } from '../../shared/defaults';

// Komodo personalities - all available at any ELO
const PERSONALITIES: Personality[] = ['Default', 'Aggressive', 'Defensive', 'Active', 'Positional', 'Endgame', 'Beginner', 'Human'];


export function Sidebar() {
  const { settings, setSettings: setSettingsBase, connected, sidebarOpen, toggleSidebar, boardConfig, redetectPlayerColor, requestTurnRedetect, requestReanalyze, isGamePage, sideToMove, lastGamePlayerColor } = useAppStore();
  const { activeSnapshot, selectedSuggestionIndex, setSelectedSuggestionIndex, newAccuracyCache } = useFeedbackStore();
  const { user, signOut } = useAuthStore();
  const { t } = useTranslation();
  const isRTL = useIsRTL();

  // Wrapper to include userId for cloud sync
  const setSettings = (partial: Partial<typeof settings>) => {
    setSettingsBase(partial, user?.id);
  };

  // Get personality info with translations
  const getPersonalityInfo = (personality: Personality) => {
    return t.personalities[personality];
  };

  // Local state for ELO sliders with debounce
  const [localUserElo, setLocalUserElo] = useState(settings.userElo);
  const [localRiskTaking, setLocalRiskTaking] = useState(settings.riskTaking);
  const [localSkill, setLocalSkill] = useState(settings.skill);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const riskDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const skillDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Settings modal state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Animation states for refresh buttons
  const [colorSpinning, setColorSpinning] = useState(false);
  const [turnSpinning, setTurnSpinning] = useState(false);

  // ELO card expanded state
  const [eloExpanded, setEloExpanded] = useState(false);

  // Sync local ELO when settings change externally
  useEffect(() => {
    setLocalUserElo(settings.userElo);
  }, [settings.userElo]);

  useEffect(() => {
    setLocalRiskTaking(settings.riskTaking);
  }, [settings.riskTaking]);

  useEffect(() => {
    setLocalSkill(settings.skill);
  }, [settings.skill]);

  const handleEloChange = (value: number) => {
    setLocalUserElo(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Disable full strength mode if ELO drops below 3000
      const newSettings: Partial<Settings> = { userElo: value, targetElo: value + 150 };
      if (value + 150 < 3000 && settings.disableLimitStrength) {
        newSettings.disableLimitStrength = false;
      }
      setSettings(newSettings);
    }, 300);
  };

  const handleRiskTakingChange = (value: number) => {
    setLocalRiskTaking(value);
    if (riskDebounceRef.current) clearTimeout(riskDebounceRef.current);
    riskDebounceRef.current = setTimeout(() => {
      setSettings({ riskTaking: value });
      requestReanalyze();
    }, 300);
  };

  const handleSkillChange = (value: number) => {
    setLocalSkill(value);
    if (skillDebounceRef.current) clearTimeout(skillDebounceRef.current);
    skillDebounceRef.current = setTimeout(() => {
      setSettings({ skill: value });
      requestReanalyze();
    }, 300);
  };

  // RTL-aware styles
  const OpenIcon = isRTL ? ChevronRight : ChevronLeft;
  const CloseIcon = isRTL ? ChevronLeft : ChevronRight;
  const shadowStyle = isRTL
    ? { boxShadow: '8px 0 30px rgba(0, 0, 0, 0.5), 2px 0 10px rgba(59, 130, 246, 0.1)' }
    : { boxShadow: '-8px 0 30px rgba(0, 0, 0, 0.5), -2px 0 10px rgba(59, 130, 246, 0.1)' };

  return (
    <div className={cn(
      'tw-fixed tw-top-0 tw-h-screen tw-z-[10000] tw-flex tw-font-sans tw-select-none',
      isRTL ? 'tw-left-0' : 'tw-right-0'
    )}>
      {/* Toggle button */}
      <Button
        variant="outline"
        size="icon"
        onClick={toggleSidebar}
        className={cn(
          'tw-self-start tw-mt-4 !tw-bg-card tw-text-foreground tw-p-3 tw-shadow-lg hover:!tw-bg-accent tw-border tw-border-border tw-h-auto tw-z-10',
          isRTL
            ? 'tw-rounded-r-lg tw-rounded-l-none tw-border-l-0 tw-order-2'
            : 'tw-rounded-l-lg tw-rounded-r-none tw-border-r-0'
        )}
      >
        {sidebarOpen ? <CloseIcon className="tw-w-5 tw-h-5" /> : <OpenIcon className="tw-w-5 tw-h-5" />}
      </Button>

      {/* Sidebar content - conditionally rendered */}
      {sidebarOpen && (
        <div
          className={cn(
            'tw-w-72 tw-bg-background tw-text-foreground tw-flex tw-flex-col tw-h-full',
            isRTL && 'tw-order-1'
          )}
          style={shadowStyle}
        >
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
        {!isGamePage ? (
          /* Review/Analysis page - show last game info if available */
          lastGamePlayerColor && activeSnapshot?.accuracy ? (
            <>
              {/* Last Game Info */}
              <Card>
                <div className="tw-text-center">
                  <div className="tw-text-[10px] tw-text-muted tw-uppercase tw-mb-1">{t.player.lastGamePlayed}</div>
                  <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                    <span className="tw-text-xs tw-text-muted">{t.player.myColor}:</span>
                    <span className="tw-font-semibold">
                      {lastGamePlayerColor === 'white' ? `⬜ ${t.player.white}` : `⬛ ${t.player.black}`}
                    </span>
                  </div>
                </div>
              </Card>

              {/* Accuracy Widget */}
              {settings.showRollingAccuracy && newAccuracyCache && newAccuracyCache.moveAnalyses.length > 0 && (
                <NewAccuracyWidget cache={newAccuracyCache} />
              )}
            </>
          ) : (
            /* Start game message */
            <Card>
              <div className="tw-text-center tw-py-4">
                <img
                  src={chrome.runtime.getURL('icons/chessr-logo.png')}
                  alt="Chessr"
                  className="tw-w-16 tw-h-16 tw-mx-auto tw-mb-3 tw-opacity-50"
                />
                <div className="tw-text-sm tw-text-muted">
                  Start a game to use Chessr
                </div>
              </div>
            </Card>
          )
        ) : (
          <>
            {/* Player Info - Two Columns */}
            <Card>
              <div className="tw-grid tw-grid-cols-2 tw-gap-2">
                {/* My color column */}
                <div className="tw-text-center">
                  <div className="tw-text-[10px] tw-text-muted tw-mb-1">{t.player.myColor}</div>
                  <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                    <span className="tw-font-semibold">
                      {boardConfig?.playerColor === 'white' ? `⬜ ${t.player.white}` : `⬛ ${t.player.black}`}
                    </span>
                    <button
                      onClick={() => {
                        setColorSpinning(true);
                        redetectPlayerColor();
                        setTimeout(() => setColorSpinning(false), 400);
                      }}
                      className="tw-text-muted hover:tw-text-foreground tw-transition-colors tw-p-0.5"
                      title="Re-detect color"
                    >
                      <RotateCw className={cn('tw-w-3 tw-h-3', colorSpinning && 'animate-tilt')} />
                    </button>
                  </div>
                </div>
                {/* Turn column */}
                <div className="tw-text-center">
                  <div className="tw-text-[10px] tw-text-muted tw-mb-1">{t.player.turn}</div>
                  <div className="tw-flex tw-items-center tw-justify-center tw-gap-1">
                    <span className="tw-font-semibold">
                      {sideToMove === 'w' ? `⬜ ${t.player.white}` : sideToMove === 'b' ? `⬛ ${t.player.black}` : '--'}
                    </span>
                    <button
                      onClick={() => {
                        setTurnSpinning(true);
                        requestTurnRedetect();
                        setTimeout(() => setTurnSpinning(false), 400);
                      }}
                      className="tw-text-muted hover:tw-text-foreground tw-transition-colors tw-p-0.5"
                      title="Refresh turn"
                    >
                      <RotateCw className={cn('tw-w-3 tw-h-3', turnSpinning && 'animate-tilt')} />
                    </button>
                  </div>
                </div>
              </div>
            </Card>

            {/* ELO */}
            <Card className="!tw-p-3">
              {/* Header - always visible, clickable to expand/collapse */}
              <button
                onClick={() => setEloExpanded(!eloExpanded)}
                className="tw-w-full tw-flex tw-items-center tw-justify-between tw-text-left"
              >
                <div className="tw-flex tw-items-center tw-gap-3 tw-flex-wrap">
                  <div>
                    <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.elo.title}</div>
                    <div className="tw-text-base tw-font-semibold tw-text-primary">{localUserElo + 150}</div>
                  </div>
                  <div>
                    <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.engine.riskTaking}</div>
                    <div className="tw-text-base tw-font-semibold tw-text-primary">{localRiskTaking}%</div>
                  </div>
                  <div>
                    <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.engine.skill}</div>
                    <div className="tw-text-base tw-font-semibold tw-text-primary">{localSkill}</div>
                  </div>
                  <div>
                    <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.personalities.title}</div>
                    <div className="tw-text-base tw-font-semibold tw-text-primary">{getPersonalityInfo(settings.personality).label}</div>
                  </div>
                </div>
                {eloExpanded ? (
                  <ChevronUp className="tw-w-4 tw-h-4 tw-text-muted" />
                ) : (
                  <ChevronDown className="tw-w-4 tw-h-4 tw-text-muted" />
                )}
              </button>

              {/* Expanded content */}
              {eloExpanded && (
                <div className="tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
                  {/* Target ELO */}
                  <div className="tw-flex tw-items-start tw-justify-between tw-mb-1">
                    <div className="tw-flex tw-flex-col tw-gap-0.5">
                      <div className="tw-flex tw-items-center tw-gap-1.5">
                        <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.elo.title}</div>
                        <label className="tw-flex tw-items-center tw-gap-1 tw-cursor-pointer">
                          <Checkbox
                            checked={settings.autoDetectTargetElo}
                            onCheckedChange={(checked: boolean) => setSettings({ autoDetectTargetElo: checked })}
                          />
                          <span className="tw-text-[9px] tw-text-muted">Auto</span>
                        </label>
                      </div>
                      <div className="tw-text-[10px] tw-text-muted">
                        User: {localUserElo} + 150
                      </div>
                    </div>
                    <div className="tw-text-base tw-font-semibold tw-text-primary">
                      {localUserElo + 150}
                    </div>
                  </div>
                  <Slider
                    value={localUserElo}
                    onValueChange={handleEloChange}
                    min={300}
                    max={3000}
                    step={50}
                    disabled={settings.autoDetectTargetElo}
                  />

                  {/* Risk Taking */}
                  <div className="tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
                    <div className="tw-flex tw-items-center tw-justify-between tw-mb-1">
                      <div>
                        <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.engine.riskTaking}</div>
                        <div className="tw-text-[10px] tw-text-muted">
                          {localRiskTaking}%
                        </div>
                      </div>
                      <div className="tw-text-base tw-font-semibold tw-text-primary">
                        {getRiskLabel(localRiskTaking)}
                      </div>
                    </div>
                    <Slider
                      value={localRiskTaking}
                      onValueChange={handleRiskTakingChange}
                      min={0}
                      max={100}
                      step={1}
                    />
                    <p className="tw-text-[10px] tw-text-muted tw-mt-1">
                      {t.engine.riskTakingDesc}
                    </p>
                  </div>

                  {/* Skill */}
                  <div className="tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
                    <div className="tw-flex tw-items-center tw-justify-between tw-mb-1">
                      <div>
                        <div className="tw-text-[10px] tw-text-muted tw-uppercase">{t.engine.skill}</div>
                        <div className="tw-text-[10px] tw-text-muted">
                          {localSkill}
                        </div>
                      </div>
                      <div className="tw-text-base tw-font-semibold tw-text-primary">
                        {getSkillLabel(localSkill)}
                      </div>
                    </div>
                    <Slider
                      value={localSkill}
                      onValueChange={handleSkillChange}
                      min={1}
                      max={25}
                      step={1}
                    />
                    <p className="tw-text-[10px] tw-text-muted tw-mt-1">
                      {t.engine.skillDesc}
                    </p>
                  </div>

                  {/* Personality */}
                  <div className="tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
                    <div className="tw-text-[10px] tw-text-muted tw-uppercase tw-mb-1">{t.personalities.title}</div>
                    <Select
                      value={settings.personality}
                      onValueChange={(value) => {
                        setSettings({ personality: value as Personality });
                        requestReanalyze();
                      }}
                      options={PERSONALITIES.map((personality) => ({
                        value: personality,
                        label: getPersonalityInfo(personality).label,
                      }))}
                    />
                    <p className="tw-text-[10px] tw-text-muted tw-mt-1">
                      {getPersonalityInfo(settings.personality).description}
                    </p>
                  </div>

                  {/* Full Strength Toggle (only visible at 3000+ target ELO) */}
                  {(localUserElo + 150) >= 3000 && (
                    <div className="tw-mt-3 tw-pt-3 tw-border-t tw-border-border">
                      <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
                        <div className="tw-flex-1">
                          <div className="tw-text-xs tw-font-medium tw-text-foreground tw-mb-0.5">
                            {t.elo.fullStrength}
                          </div>
                          <div className="tw-text-[10px] tw-text-muted tw-leading-tight">
                            {t.elo.fullStrengthDesc}
                          </div>
                        </div>
                        <Switch
                          checked={settings.disableLimitStrength}
                          onCheckedChange={(checked) => {
                            setSettings({ disableLimitStrength: checked });
                            requestReanalyze();
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Accuracy Widget */}
            {settings.showRollingAccuracy && newAccuracyCache && newAccuracyCache.moveAnalyses.length > 0 && (
              <NewAccuracyWidget cache={newAccuracyCache} />
            )}

            {/* Suggestions */}
            {settings.showSuggestions && activeSnapshot?.suggestions && activeSnapshot.suggestions.length > 0 && (
              <div className="tw-space-y-2">
                {activeSnapshot.suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.index}
                    suggestion={suggestion}
                    isSelected={selectedSuggestionIndex === suggestion.index}
                    showPromotionAsText={settings.showPromotionAsText}
                    playerColor={boardConfig?.playerColor}
                    onSelect={() => setSelectedSuggestionIndex(suggestion.index)}
                  />
                ))}
              </div>
            )}

            {/* Opening Selector */}
            <OpeningSelector />


          </>
        )}
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
