import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/card';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../ui/switch';
import { ChevronDown } from 'lucide-react';
import {
  useEngineStore,
  getAmbitionLabelKey,
  getAmbitionDescKey,
  PERSONALITIES,
  PERSONALITY_INFO,
  type Personality,
} from '../../stores/engineStore';
import { useGameStore } from '../../stores/gameStore';
import { usePlanLimits } from '../../lib/planUtils';
import { UpgradeButton } from '../ui/plan-badge';

// ============================================================================
// Target ELO Section
// ============================================================================
function TargetEloSection() {
  const { t } = useTranslation(['engine', 'common']);
  const {
    opponentElo,
    userElo,
    autoEloBoost,
    targetEloAuto,
    targetEloManual,
    getTargetElo,
    setTargetEloAuto,
    setTargetEloManual,
  } = useEngineStore();
  const { maxElo } = usePlanLimits();
  const isLimited = maxElo < 3500;

  const targetElo = getTargetElo();
  // Clamp displayed value to max allowed
  const displayElo = Math.min(targetElo, maxElo);
  // Auto label: base + boost
  const autoLabel = opponentElo > 0 ? `${opponentElo} + ${autoEloBoost}` : `${userElo} + ${autoEloBoost}`;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <p className="tw-text-sm tw-font-medium">{t('targetElo')}</p>
          {isLimited && <UpgradeButton tooltip={t('unlockEloRange')} />}
        </div>
        <span className="tw-text-base tw-font-bold tw-text-primary">
          {displayElo}
        </span>
      </div>
      <Slider
        value={[targetEloAuto ? displayElo : Math.min(targetEloManual, maxElo)]}
        onValueChange={([value]) => !targetEloAuto && setTargetEloManual(value)}
        min={400}
        max={maxElo}
        step={10}
        disabled={targetEloAuto}
        className={targetEloAuto ? 'tw-opacity-50' : ''}
      />
      <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
        <Checkbox
          checked={targetEloAuto}
          onCheckedChange={(checked) => setTargetEloAuto(checked === true)}
        />
        <span className="tw-text-xs tw-text-muted-foreground">
          {t('auto')} ({autoLabel})
        </span>
      </label>
    </div>
  );
}

// ============================================================================
// Ambition Section
// ============================================================================
function AmbitionSection() {
  const { t } = useTranslation('engine');
  const { ambition, ambitionAuto, setAmbition, setAmbitionAuto } = useEngineStore();
  const { canControlAmbition } = usePlanLimits();
  const isLimited = !canControlAmbition;

  // Free users are forced to auto
  const effectiveAuto = isLimited || ambitionAuto;
  const displayAmbition = ambition;
  const isDisabled = effectiveAuto;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <p className="tw-text-sm tw-font-medium">{t('ambition')}</p>
          {isLimited && <UpgradeButton tooltip={t('unlockAmbition')} />}
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          {!effectiveAuto && (
            <span className="tw-text-xs tw-text-muted-foreground">{displayAmbition}%</span>
          )}
          <span className="tw-text-base tw-font-bold tw-text-primary">
            {effectiveAuto ? t('auto') : t(getAmbitionLabelKey(displayAmbition))}
          </span>
        </div>
      </div>
      <Slider
        value={[effectiveAuto ? 0 : displayAmbition]}
        onValueChange={([value]) => !isDisabled && setAmbition(value)}
        min={-100}
        max={100}
        step={1}
        disabled={isDisabled}
        className={isDisabled ? 'tw-opacity-50' : ''}
      />
      <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
        <Checkbox
          checked={effectiveAuto}
          onCheckedChange={(checked) => !isLimited && setAmbitionAuto(checked === true)}
          disabled={isLimited}
        />
        <span className="tw-text-xs tw-text-muted-foreground">
          {t('autoEngineDefault')}
        </span>
      </label>
      {!effectiveAuto && (
        <p className="tw-text-xs tw-text-muted-foreground">
          {t(getAmbitionDescKey(displayAmbition))}
        </p>
      )}
    </div>
  );
}

// ============================================================================

// ============================================================================
// Personality Section
// ============================================================================
function PersonalitySection() {
  const { t } = useTranslation('engine');
  const { personality, setPersonality } = useEngineStore();
  const { isPersonalityAllowed } = usePlanLimits();
  const info = PERSONALITY_INFO[personality];

  // Check if current personality is allowed, if not reset to Default
  const currentAllowed = isPersonalityAllowed(personality);

  const handleChange = (value: string) => {
    if (isPersonalityAllowed(value)) {
      setPersonality(value as Personality);
    }
  };

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <span className="tw-text-sm tw-font-medium">{t('personality')}</span>
          {!isPersonalityAllowed('Human') && <UpgradeButton tooltip={t('unlockPersonalities')} />}
        </div>
        <select
          value={currentAllowed ? personality : 'Default'}
          onChange={(e) => handleChange(e.target.value)}
          className="tw-w-[140px] tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
        >
          {PERSONALITIES.map((p) => {
            const allowed = isPersonalityAllowed(p);
            return (
              <option key={p} value={p} disabled={!allowed}>
                {t(PERSONALITY_INFO[p].labelKey)}{!allowed ? ' 🔒' : ''}
              </option>
            );
          })}
        </select>
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">{t(info.descKey)}</p>
    </div>
  );
}

// ============================================================================
// Variety Section
// ============================================================================
function VarietySection() {
  const { t } = useTranslation('engine');
  const { variety, setVariety } = useEngineStore();
  const { canUseVariety } = usePlanLimits();
  const isLimited = !canUseVariety;

  const displayVariety = isLimited ? 0 : variety;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <span className="tw-text-sm tw-font-medium">{t('moveVariety')}</span>
          {isLimited && <UpgradeButton tooltip={t('unlockVariety')} />}
        </div>
        <span className="tw-text-base tw-font-bold tw-text-primary">{displayVariety}</span>
      </div>
      <Slider
        value={[displayVariety]}
        onValueChange={([value]) => !isLimited && setVariety(value)}
        min={0}
        max={10}
        step={1}
        disabled={isLimited}
        className={isLimited ? 'tw-opacity-50' : ''}
      />
      <p className="tw-text-xs tw-text-muted-foreground">
        {displayVariety === 0
          ? t('varietyZero')
          : t('varietyDesc')}
      </p>
    </div>
  );
}

// ============================================================================
// Armageddon Section
// ============================================================================
function ArmageddonSection() {
  const { t } = useTranslation(['engine', 'common']);
  const { armageddon, setArmageddon } = useEngineStore();
  const playerColor = useGameStore((state) => state.playerColor);
  const { canUseArmageddon } = usePlanLimits();

  const colorLabel = playerColor === 'white' ? t('common:white') : playerColor === 'black' ? t('common:black') : 'You';

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <span className="tw-text-sm tw-font-medium">{t('armageddon')}</span>
          {!canUseArmageddon && <UpgradeButton tooltip={t('unlockArmageddon')} />}
          {canUseArmageddon && armageddon && (
            <span className="tw-text-xs tw-text-red-400">{t('mustWin', { color: colorLabel })}</span>
          )}
        </div>
        <Switch
          checked={canUseArmageddon && armageddon}
          onCheckedChange={setArmageddon}
          disabled={!canUseArmageddon}
          className={!canUseArmageddon ? 'tw-opacity-50' : ''}
        />
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">
        {armageddon && canUseArmageddon
          ? t('armageddonActive')
          : t('armageddonDesc')}
      </p>
    </div>
  );
}

// ============================================================================
// Unlock ELO Section (visible only when targetElo >= 3000)
// ============================================================================
function UnlockEloSection() {
  const { t } = useTranslation('engine');
  const {
    getTargetElo, disableLimitStrength, setDisableLimitStrength,
    searchMode, setSearchMode, searchNodes, setSearchNodes,
    searchDepth, setSearchDepth, searchMovetime, setSearchMovetime,
  } = useEngineStore();
  const targetElo = getTargetElo();

  // Reset disableLimitStrength when ELO drops below threshold
  useEffect(() => {
    if (targetElo < 3000 && disableLimitStrength) {
      setDisableLimitStrength(false);
    }
  }, [targetElo, disableLimitStrength, setDisableLimitStrength]);

  // Only show when target ELO is high enough
  if (targetElo < 3000) {
    return null;
  }

  const formatSearchValue = () => {
    switch (searchMode) {
      case 'nodes': return searchNodes >= 1_000_000 ? `${(searchNodes / 1_000_000).toFixed(1)}M` : `${(searchNodes / 1000).toFixed(0)}k`;
      case 'depth': return `${searchDepth}`;
      case 'movetime': return `${(searchMovetime / 1000).toFixed(1)}s`;
    }
  };

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div>
          <span className="tw-text-sm tw-font-medium">{t('unlockFullStrength')}</span>
        </div>
        <Switch
          checked={disableLimitStrength}
          onCheckedChange={setDisableLimitStrength}
        />
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">
        {t('unlockFullStrengthDesc')}
      </p>
      {disableLimitStrength && (
        <div className="tw-space-y-2 tw-pt-1">
          <div className="tw-flex tw-items-center tw-justify-between">
            <div className="tw-flex tw-items-center tw-gap-2">
              <select
                value={searchMode}
                onChange={(e) => setSearchMode(e.target.value as 'nodes' | 'depth' | 'movetime')}
                className="tw-h-7 tw-px-2 tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-xs"
              >
                <option value="nodes">{t('nodes')}</option>
                <option value="depth">{t('depth')}</option>
                <option value="movetime">{t('moveTime')}</option>
              </select>
            </div>
            <span className="tw-text-base tw-font-bold tw-text-primary">{formatSearchValue()}</span>
          </div>
          {searchMode === 'nodes' && (
            <Slider
              value={[searchNodes]}
              onValueChange={([value]) => setSearchNodes(value)}
              min={100000}
              max={5000000}
              step={100000}
            />
          )}
          {searchMode === 'depth' && (
            <Slider
              value={[Math.min(searchDepth, 20)]}
              onValueChange={([value]) => setSearchDepth(value)}
              min={1}
              max={20}
              step={1}
            />
          )}
          {searchMode === 'movetime' && (
            <Slider
              value={[Math.min(searchMovetime, 3000)]}
              onValueChange={([value]) => setSearchMovetime(value)}
              min={500}
              max={3000}
              step={100}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main EloSettings Card (Collapsible)
// ============================================================================
export function EloSettings() {
  const { t } = useTranslation('engine');
  const [expanded, setExpanded] = useState(true);
  const { getTargetElo, personality, ambition, ambitionAuto, armageddon } = useEngineStore();
  const { canControlAmbition, canUseArmageddon } = usePlanLimits();

  const targetElo = getTargetElo();
  const personalityLabel = t(PERSONALITY_INFO[personality].labelKey);
  const isArmageddonActive = canUseArmageddon && armageddon;
  const effectiveAuto = !canControlAmbition || ambitionAuto;

  return (
    <Card className="tw-bg-muted/50 tw-overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="tw-w-full tw-flex tw-items-center tw-justify-between tw-p-4 tw-cursor-pointer hover:tw-bg-muted/30 tw-transition-all tw-duration-200 tw-bg-transparent tw-rounded-lg"
      >
        <div className="tw-flex tw-flex-col tw-items-start tw-gap-1.5 tw-flex-1">
          <span className="tw-text-sm tw-font-semibold">{t('engineSettings')}</span>
          {!expanded && (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11px]">
              {isArmageddonActive ? (
                <span className="tw-px-2 tw-py-0.5 tw-bg-red-500/20 tw-text-red-400 tw-rounded tw-font-medium">
                  {t('armageddon')}
                </span>
              ) : (
                <span className="tw-px-2 tw-py-0.5 tw-bg-primary/10 tw-text-primary tw-rounded tw-font-medium">
                  {targetElo} ELO
                </span>
              )}
              <span className="tw-text-muted-foreground">•</span>
              <span className="tw-text-muted-foreground">{effectiveAuto ? t('auto') : `${ambition}%`} {t('ambition').toLowerCase()}</span>
              <span className="tw-text-muted-foreground">•</span>
              <span className="tw-text-muted-foreground">{personalityLabel}</span>
            </div>
          )}
        </div>
        <div className={`tw-transition-transform tw-duration-200 ${expanded ? 'tw-rotate-180' : ''}`}>
          <ChevronDown className="tw-h-4 tw-w-4 tw-text-muted-foreground" />
        </div>
      </button>

      {/* Expandable Content with animation */}
      <div className={`tw-grid tw-transition-all tw-duration-200 ${expanded ? 'tw-grid-rows-[1fr]' : 'tw-grid-rows-[0fr]'}`}>
        <div className="tw-overflow-hidden">
          <CardContent className="tw-p-4 tw-pt-0 tw-space-y-5">
            <TargetEloSection />
            <AmbitionSection />
            <PersonalitySection />
            <VarietySection />
            <ArmageddonSection />
            <UnlockEloSection />
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
