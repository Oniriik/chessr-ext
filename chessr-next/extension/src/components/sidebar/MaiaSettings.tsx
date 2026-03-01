import { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { ChevronDown } from 'lucide-react';
import { useEngineStore, type MaiaMode } from '../../stores/engineStore';
import { useMaiaWebSocketStore } from '../../stores/maiaWebSocketStore';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { PlanBadge, type Plan } from '../ui/plan-badge';

// ============================================================================
// Maia Target ELO Section (Your ELO)
// ============================================================================
function MaiaTargetEloSection() {
  const {
    maiaEloSelfAuto, setMaiaEloSelfAuto,
    maiaEloSelf, setMaiaEloSelf,
    getMaiaEloSelf, userElo, opponentElo, autoEloBoost,
  } = useEngineStore();

  const effectiveElo = getMaiaEloSelf();
  const autoLabel = opponentElo > 0 ? `${opponentElo} + ${autoEloBoost}` : `${userElo} + ${autoEloBoost}`;

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <p className="tw-text-sm tw-font-medium">Target ELO</p>
        <span className="tw-text-base tw-font-bold tw-text-primary">
          {effectiveElo}
        </span>
      </div>
      <Slider
        value={[maiaEloSelfAuto ? effectiveElo : maiaEloSelf]}
        onValueChange={([value]) => !maiaEloSelfAuto && setMaiaEloSelf(value)}
        min={400}
        max={3000}
        step={10}
        disabled={maiaEloSelfAuto}
        className={maiaEloSelfAuto ? 'tw-opacity-50' : ''}
      />
      <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
        <Checkbox
          checked={maiaEloSelfAuto}
          onCheckedChange={(checked) => setMaiaEloSelfAuto(checked === true)}
        />
        <span className="tw-text-xs tw-text-muted-foreground">
          Auto ({autoLabel})
        </span>
      </label>
    </div>
  );
}

// ============================================================================
// Maia Opponent ELO Section
// ============================================================================
function MaiaOpponentEloSection() {
  const {
    maiaEloOppoAuto, setMaiaEloOppoAuto,
    maiaEloOppo, setMaiaEloOppo,
    getMaiaEloOppo, opponentElo,
  } = useEngineStore();

  const effectiveElo = getMaiaEloOppo();

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <p className="tw-text-sm tw-font-medium">Opponent ELO</p>
        <span className="tw-text-base tw-font-bold tw-text-primary">
          {effectiveElo}
        </span>
      </div>
      <Slider
        value={[maiaEloOppoAuto ? effectiveElo : maiaEloOppo]}
        onValueChange={([value]) => !maiaEloOppoAuto && setMaiaEloOppo(value)}
        min={400}
        max={3000}
        step={10}
        disabled={maiaEloOppoAuto}
        className={maiaEloOppoAuto ? 'tw-opacity-50' : ''}
      />
      <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
        <Checkbox
          checked={maiaEloOppoAuto}
          onCheckedChange={(checked) => setMaiaEloOppoAuto(checked === true)}
        />
        <span className="tw-text-xs tw-text-muted-foreground">
          Auto ({opponentElo})
        </span>
      </label>
    </div>
  );
}

// ============================================================================
// Maia Mode Section
// ============================================================================
function MaiaModeSection() {
  const { maiaMode, setMaiaMode } = useEngineStore();

  return (
    <div className="tw-space-y-2">
      <div className="tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-sm tw-font-medium">Mode</span>
        <select
          value={maiaMode}
          onChange={(e) => setMaiaMode(e.target.value as MaiaMode)}
          className="tw-w-[140px] tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
        >
          <option value="rapid">Rapid</option>
          <option value="blitz">Blitz</option>
        </select>
      </div>
      <p className="tw-text-xs tw-text-muted-foreground">
        {maiaMode === 'rapid'
          ? 'Trained on rapid games — more thoughtful, positional play'
          : 'Trained on blitz games — faster, more intuitive decisions'}
      </p>
    </div>
  );
}

// ============================================================================
// Maia Connection Status Card
// ============================================================================
export function MaiaConnectionCard() {
  const {
    isConnected, isConnecting, connect,
    maiaLoggedIn, maiaEmail, maiaPlan,
    loginWithExtensionAccount,
  } = useMaiaWebSocketStore();
  const extensionUser = useAuthStore((s) => s.user);
  const anonNames = useSettingsStore((s) => s.anonNames);
  const [connecting, setConnecting] = useState(false);

  const handleAutoConnect = async () => {
    setConnecting(true);
    try {
      await loginWithExtensionAccount();
    } finally {
      setTimeout(() => setConnecting(false), 2000);
    }
  };

  return (
    <Card className="tw-bg-muted/50 tw-overflow-hidden">
      <CardContent className="tw-p-4 tw-space-y-2">
        <div className="tw-flex tw-items-center tw-justify-between">
          <span className="tw-text-sm tw-font-semibold">Maia-2 Connection</span>
          <div className="tw-flex tw-items-center tw-gap-2">
            <span
              className={`tw-h-2 tw-w-2 tw-rounded-full ${
                isConnected
                  ? 'tw-bg-green-500'
                  : isConnecting
                    ? 'tw-bg-yellow-500 tw-animate-pulse'
                    : 'tw-bg-red-500'
              }`}
            />
            <span className="tw-text-xs tw-text-muted-foreground">
              {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>
        </div>

        {/* Disconnected */}
        {!isConnected && !isConnecting && (
          <>
            <p className="tw-text-xs tw-text-muted-foreground">
              Launch the Chessr Maia app to connect
            </p>
            <button
              onClick={() => connect()}
              className="tw-w-full tw-h-8 tw-text-xs tw-font-medium tw-rounded-md tw-border tw-border-input tw-bg-background hover:tw-bg-muted tw-transition-colors"
            >
              Retry connection
            </button>
          </>
        )}

        {/* Connected + logged in */}
        {isConnected && maiaLoggedIn && (
          <div className="tw-space-y-1.5">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className={`tw-text-xs tw-text-muted-foreground ${anonNames ? 'tw-blur-sm' : ''}`}>
                Logged in as {maiaEmail}
              </span>
              {maiaPlan && (
                <PlanBadge plan={maiaPlan as Plan} compact />
              )}
            </div>
            {maiaPlan === 'free' && (
              <p className="tw-text-xs tw-text-amber-500 tw-font-medium">
                Upgrade your plan to use Maia engine
              </p>
            )}
          </div>
        )}

        {/* Connected + not logged in */}
        {isConnected && !maiaLoggedIn && (
          <div className="tw-space-y-2">
            <p className="tw-text-xs tw-text-muted-foreground">
              Connected to local Maia-2 engine on port 8765
            </p>
            <p className="tw-text-xs tw-text-amber-500 tw-font-medium">
              Login required to get suggestions
            </p>
            {extensionUser && (
              <button
                onClick={handleAutoConnect}
                disabled={connecting}
                className="tw-w-full tw-h-8 tw-text-xs tw-font-medium tw-rounded-md tw-bg-primary tw-text-primary-foreground hover:tw-bg-primary/90 tw-transition-colors disabled:tw-opacity-50"
              >
                <span className={anonNames ? 'tw-blur-sm' : ''}>
                  {connecting ? 'Connecting...' : `Connect as ${extensionUser.email}`}
                </span>
              </button>
            )}
            <p className="tw-text-[11px] tw-text-muted-foreground tw-text-center">
              Or sign in directly in the Maia app
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main MaiaSettings Card (Collapsible)
// ============================================================================
export function MaiaSettings() {
  const [expanded, setExpanded] = useState(true);
  const { getMaiaEloSelf, getMaiaEloOppo, maiaMode } = useEngineStore();

  const eloSelf = getMaiaEloSelf();
  const eloOppo = getMaiaEloOppo();

  return (
    <Card className="tw-bg-muted/50 tw-overflow-hidden">
      {/* Collapsible Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="tw-w-full tw-flex tw-items-center tw-justify-between tw-p-4 tw-cursor-pointer hover:tw-bg-muted/30 tw-transition-all tw-duration-200 tw-bg-transparent tw-rounded-lg"
      >
        <div className="tw-flex tw-flex-col tw-items-start tw-gap-1.5 tw-flex-1">
          <span className="tw-text-sm tw-font-semibold">Maia-2 Settings</span>
          {!expanded && (
            <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-[11px]">
              <span className="tw-px-2 tw-py-0.5 tw-bg-primary/10 tw-text-primary tw-rounded tw-font-medium">
                {eloSelf} ELO
              </span>
              <span className="tw-text-muted-foreground">vs</span>
              <span className="tw-px-2 tw-py-0.5 tw-bg-primary/10 tw-text-primary tw-rounded tw-font-medium">
                {eloOppo} ELO
              </span>
              <span className="tw-text-muted-foreground">{maiaMode}</span>
            </div>
          )}
        </div>
        <div className={`tw-transition-transform tw-duration-200 ${expanded ? 'tw-rotate-180' : ''}`}>
          <ChevronDown className="tw-h-4 tw-w-4 tw-text-muted-foreground" />
        </div>
      </button>

      {/* Expandable Content */}
      <div className={`tw-grid tw-transition-all tw-duration-200 ${expanded ? 'tw-grid-rows-[1fr]' : 'tw-grid-rows-[0fr]'}`}>
        <div className="tw-overflow-hidden">
          <CardContent className="tw-p-4 tw-pt-0 tw-space-y-5">
            <MaiaTargetEloSection />
            <MaiaOpponentEloSection />
            <MaiaModeSection />
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
