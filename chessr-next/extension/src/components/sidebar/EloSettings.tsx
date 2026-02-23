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
  type ArmageddonMode,
} from '../../stores/engineStore';

// ============================================================================
// Target ELO Section
// ============================================================================
function TargetEloSection() {
  const {
    userElo,
    targetEloAuto,
    targetEloManual,
    getTargetElo,
    setTargetEloAuto,
    setTargetEloManual,
  } = useEngineStore();

  const targetElo = getTargetElo();

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <p className="tw-text-sm tw-font-medium">Target ELO</p>
        <span className="tw-text-base tw-font-bold tw-text-primary">
          {targetElo}
        </span>
      </div>
      <Slider
        value={[targetEloAuto ? targetElo : targetEloManual]}
        onValueChange={([value]) => !targetEloAuto && setTargetEloManual(value)}
        min={400}
        max={3500}
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
          Auto ({userElo} + 150)
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

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <p className="tw-text-sm tw-font-medium">Risk Taking</p>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-text-muted-foreground">{riskTaking}%</span>
          <span className="tw-text-base tw-font-bold tw-text-primary">
            {getRiskLabel(riskTaking)}
          </span>
        </div>
      </div>
      <Slider
        value={[riskTaking]}
        onValueChange={([value]) => setRiskTaking(value)}
        min={0}
        max={100}
        step={1}
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

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <p className="tw-text-sm tw-font-medium">Skill Level</p>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-xs tw-text-muted-foreground">{skill}</span>
          <span className="tw-text-base tw-font-bold tw-text-primary">
            {getSkillLabel(skill)}
          </span>
        </div>
      </div>
      <Slider
        value={[skill]}
        onValueChange={([value]) => setSkill(value)}
        min={1}
        max={25}
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
  const info = PERSONALITY_INFO[personality];

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-sm tw-font-medium">Personality</span>
        <select
          value={personality}
          onChange={(e) => setPersonality(e.target.value as Personality)}
          className="tw-w-[140px] tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
        >
          {PERSONALITIES.map((p) => (
            <option key={p} value={p}>
              {PERSONALITY_INFO[p].label}
            </option>
          ))}
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

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <div>
          <span className="tw-text-sm tw-font-medium">Armageddon</span>
          {armageddon !== 'off' && (
            <span className="tw-ml-2 tw-text-xs tw-text-red-400">must win (risky)</span>
          )}
        </div>
        <select
          value={armageddon}
          onChange={(e) => setArmageddon(e.target.value as ArmageddonMode)}
          className="tw-w-[140px] tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
        >
          <option value="off">Off</option>
          <option value="white">White Must Win</option>
          <option value="black">Black Must Win</option>
        </select>
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">
        Draw counts as loss for selected side
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
  const { getTargetElo, personality } = useEngineStore();

  const targetElo = getTargetElo();
  const personalityLabel = PERSONALITY_INFO[personality].label;

  return (
    <Card className="tw-bg-muted/50 tw-overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="tw-w-full tw-flex tw-items-center tw-justify-between tw-p-4 tw-cursor-pointer hover:tw-bg-muted/30 tw-transition-all tw-duration-200 tw-bg-transparent tw-rounded-lg"
      >
        <div className="tw-flex tw-items-center tw-gap-3 tw-flex-1">
          <span className="tw-text-sm tw-font-semibold">Engine Settings</span>
          {!expanded && (
            <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted-foreground">
              <span className="tw-px-2 tw-py-0.5 tw-bg-primary/10 tw-text-primary tw-rounded-full tw-font-medium">
                {targetElo} ELO
              </span>
              <span className="tw-px-2 tw-py-0.5 tw-bg-muted tw-rounded-full">
                {personalityLabel}
              </span>
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
