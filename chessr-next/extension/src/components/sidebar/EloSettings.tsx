import { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../ui/switch';
import { ChevronDown } from 'lucide-react';
import {
  useEngineStore,
  getRiskLabel,
  getSkillLabel,
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
  const {
    opponentElo,
    userElo,
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
  // Auto label: always +150 from base (opponent or user)
  const autoLabel = opponentElo > 0 ? `${opponentElo} + 150` : `${userElo} + 150`;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <p className="tw-text-sm tw-font-medium">Target ELO</p>
          {isLimited && <UpgradeButton tooltip="Unlock ELO 2000-3500" />}
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
          Auto ({autoLabel})
        </span>
      </label>
    </div>
  );
}

// ============================================================================
// Risk Section
// ============================================================================
function RiskSection() {
  const { riskTaking, setRiskTaking } = useEngineStore();
  const { maxRisk } = usePlanLimits();
  const isLimited = maxRisk < 100;

  // For free users: show fixed value, for premium: show actual value
  const displayRisk = isLimited ? maxRisk : riskTaking;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <p className="tw-text-sm tw-font-medium">Risk Taking</p>
          {isLimited && <UpgradeButton tooltip="Unlock risk taking control" />}
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-text-muted-foreground">{displayRisk}%</span>
          <span className="tw-text-base tw-font-bold tw-text-primary">
            {getRiskLabel(displayRisk)}
          </span>
        </div>
      </div>
      <Slider
        value={[displayRisk]}
        onValueChange={([value]) => !isLimited && setRiskTaking(value)}
        min={0}
        max={100}
        step={1}
        disabled={isLimited}
        className={isLimited ? 'tw-opacity-50' : ''}
      />
      <p className="tw-text-xs tw-text-muted-foreground">
        Too low plays passively, too high makes errors
      </p>
    </div>
  );
}

// ============================================================================
// Skill Section
// ============================================================================
function SkillSection() {
  const { skill, setSkill } = useEngineStore();
  const { maxSkill } = usePlanLimits();
  const isLimited = maxSkill < 25;

  // For free users: show fixed value, for premium: show actual value
  const displaySkill = isLimited ? maxSkill : skill;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <p className="tw-text-sm tw-font-medium">Skill Level</p>
          {isLimited && <UpgradeButton tooltip="Unlock skill level control" />}
        </div>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-text-muted-foreground">{displaySkill}</span>
          <span className="tw-text-base tw-font-bold tw-text-primary">
            {getSkillLabel(displaySkill)}
          </span>
        </div>
      </div>
      <Slider
        value={[displaySkill]}
        onValueChange={([value]) => !isLimited && setSkill(value)}
        min={1}
        max={25}
        disabled={isLimited}
        className={isLimited ? 'tw-opacity-50' : ''}
        step={1}
      />
      <p className="tw-text-xs tw-text-muted-foreground">
        Engine playing strength level
      </p>
    </div>
  );
}

// ============================================================================
// Personality Section
// ============================================================================
function PersonalitySection() {
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
          <span className="tw-text-sm tw-font-medium">Personality</span>
          {!isPersonalityAllowed('Human') && <UpgradeButton tooltip="Unlock all 8 personalities" />}
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
                {PERSONALITY_INFO[p].label}{!allowed ? ' 🔒' : ''}
              </option>
            );
          })}
        </select>
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">{info.description}</p>
    </div>
  );
}

// ============================================================================
// Armageddon Section
// ============================================================================
function ArmageddonSection() {
  const { armageddon, setArmageddon } = useEngineStore();
  const playerColor = useGameStore((state) => state.playerColor);
  const { canUseArmageddon } = usePlanLimits();

  const colorLabel = playerColor === 'white' ? 'White' : playerColor === 'black' ? 'Black' : 'You';

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div className="tw-flex tw-items-center tw-gap-1.5">
          <span className="tw-text-sm tw-font-medium">Armageddon</span>
          {!canUseArmageddon && <UpgradeButton tooltip="Unlock Armageddon mode" />}
          {canUseArmageddon && armageddon && (
            <span className="tw-text-xs tw-text-red-400">{colorLabel} must win</span>
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
          ? 'Engine will play aggressively to avoid draws'
          : 'Enable to force wins — draws count as losses'}
      </p>
    </div>
  );
}

// ============================================================================
// Unlock ELO Section (visible only when targetElo >= 3000)
// ============================================================================
function UnlockEloSection() {
  const { getTargetElo, disableLimitStrength, setDisableLimitStrength } = useEngineStore();
  const targetElo = getTargetElo();

  // Only show when target ELO is high enough
  if (targetElo < 3000) {
    return null;
  }

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div>
          <span className="tw-text-sm tw-font-medium">Unlock Full Strength</span>
        </div>
        <Switch
          checked={disableLimitStrength}
          onCheckedChange={setDisableLimitStrength}
        />
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">
        Unlock maximum engine strength at 3500 ELO
      </p>
    </div>
  );
}

// ============================================================================
// Main EloSettings Card (Collapsible)
// ============================================================================
export function EloSettings() {
  const [expanded, setExpanded] = useState(true);
  const { getTargetElo, personality, riskTaking, skill, armageddon } = useEngineStore();
  const { maxRisk, maxSkill, canUseArmageddon } = usePlanLimits();

  const targetElo = getTargetElo();
  const personalityLabel = PERSONALITY_INFO[personality].label;
  const isArmageddonActive = canUseArmageddon && armageddon;

  // For display in collapsed state
  const displayRisk = maxRisk < 100 ? maxRisk : riskTaking;
  const displaySkill = maxSkill < 25 ? maxSkill : skill;

  return (
    <Card className="tw-bg-muted/50 tw-overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="tw-w-full tw-flex tw-items-center tw-justify-between tw-p-4 tw-cursor-pointer hover:tw-bg-muted/30 tw-transition-all tw-duration-200 tw-bg-transparent tw-rounded-lg"
      >
        <div className="tw-flex tw-flex-col tw-items-start tw-gap-1.5 tw-flex-1">
          <span className="tw-text-sm tw-font-semibold">Engine Settings</span>
          {!expanded && (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11px]">
              {isArmageddonActive ? (
                <span className="tw-px-2 tw-py-0.5 tw-bg-red-500/20 tw-text-red-400 tw-rounded tw-font-medium">
                  Armageddon
                </span>
              ) : (
                <span className="tw-px-2 tw-py-0.5 tw-bg-primary/10 tw-text-primary tw-rounded tw-font-medium">
                  {targetElo} ELO
                </span>
              )}
              <span className="tw-text-muted-foreground">•</span>
              <span className="tw-text-muted-foreground">{displayRisk}% risk</span>
              <span className="tw-text-muted-foreground">•</span>
              <span className="tw-text-muted-foreground">Lv.{displaySkill}</span>
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
            <RiskSection />
            <SkillSection />
            <PersonalitySection />
            <ArmageddonSection />
            <UnlockEloSection />
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
