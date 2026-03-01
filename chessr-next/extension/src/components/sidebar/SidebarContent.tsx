import { useState, useEffect } from 'react';
import { AuthGuard } from '../auth';
import { useAuthStore } from '../../stores/authStore';
import { useVersionStore } from '../../stores/versionStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { LogOut, X, Settings, ArrowLeft } from 'lucide-react';
import { MaintenanceBanner } from './MaintenanceBanner';
import { DiscordLinkBanner } from './DiscordLinkBanner';
import { GameStatusCard } from './GameStatusCard';
import { GameStatsCard } from './GameStatsCard';
import { MoveListDisplay } from './MoveListDisplay';
import { EloSettings } from './EloSettings';
import { MaiaSettings, MaiaConnectionCard } from './MaiaSettings';
import { OpeningRepertoireSelector } from './OpeningRepertoireSelector';
import { useEngineStore } from '../../stores/engineStore';
import { UpdateRequiredCard } from './UpdateRequiredCard';
import { SettingsView } from './settings';
import { PlanBadge } from '../ui/plan-badge';
import { useGameDetection } from '../../hooks/useGameDetection';
import { useOpeningTrigger } from '../../hooks/useOpeningTrigger';
import { useSidebar } from '../../hooks/useSidebar';
import { useContainerWidth } from '../../hooks/useContainerWidth';

/**
 * SIDEBAR COMPONENTS ARCHITECTURE
 * ================================
 *
 * IMPLEMENTED:
 * ✓ SidebarHeader         → Logo, title, PlanBadge, logout & close buttons
 * ✓ PlanBadge             → Plan status badge (lifetime/beta/premium/freetrial/free)
 *                           Responsive: compact mode (icon + tooltip) when < 350px
 * ✓ GameStatusCard        → Game detection status display
 * ✓ EloSettings           → Target ELO, Risk, Personality, Armageddon, Unlock ELO
 * ✓ Tooltip               → CSS-based tooltip (no portals, avoids DOM shifts)
 * ✓ useContainerWidth     → ResizeObserver hook for responsive behavior
 *
 * PLANNED:
 * - RollingAccuracy       → Accuracy % with trend arrow + plies count
 * - MoveStatsGrid         → Grid showing !!, !, Best, Exc, Good, Book, ?!, ?, ??
 * - MoveSuggestionList    → List of suggested moves
 * - MoveSuggestionCard    → Individual move with rank, name, eval, quality badges
 * - QualityBadge          → Reusable badge (Best, Safe, Risky, etc.)
 * - EffectIcon            → Icons for captures, checks, etc.
 *
 * Components: src/components/sidebar/
 * UI primitives: src/components/ui/
 */

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

function SidebarHeader({
  compactBadge,
  showSettings,
  onSettingsToggle
}: {
  compactBadge: boolean;
  showSettings: boolean;
  onSettingsToggle: () => void;
}) {
  const { signOut, plan, planExpiry } = useAuthStore();
  const { toggle } = useSidebar();

  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-mb-4">
      <div className="tw-flex tw-items-center tw-gap-2">
        {showSettings ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSettingsToggle}
              className="tw-h-8 tw-w-8"
              title="Back"
            >
              <ArrowLeft className="tw-h-4 tw-w-4" />
            </Button>
            <span className="tw-text-lg tw-font-semibold">Settings</span>
          </>
        ) : (
          <>
            <img
              src={chrome.runtime.getURL('icons/icon48.png')}
              alt="Chessr"
              className="tw-w-8 tw-h-8"
            />
            <span className="tw-text-lg tw-font-semibold">Chessr.io</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onSettingsToggle}
              className="tw-h-6 tw-w-6"
              title="Settings"
            >
              <Settings className="tw-h-4 tw-w-4" />
            </Button>
            <PlanBadge plan={plan} expiry={planExpiry} compact={compactBadge} />
          </>
        )}
      </div>
      <div className="tw-flex tw-items-center tw-gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          className="tw-h-8 tw-w-8"
          title="Sign out"
        >
          <LogOut className="tw-h-4 tw-w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="tw-h-8 tw-w-8"
          title="Close sidebar"
        >
          <X className="tw-h-4 tw-w-4" />
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedContent() {
  // Check version on mount
  const { updateRequired, checkVersion } = useVersionStore();
  useEffect(() => {
    checkVersion();
  }, [checkVersion]);

  // Initialize game detection (waits for move list, observes changes)
  useGameDetection();
  // Initialize opening book features
  useOpeningTrigger();

  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const compactBadge = containerWidth > 0 && containerWidth < 350;
  const [showSettings, setShowSettings] = useState(false);

  // If update required, show only the update card (blocks everything else)
  if (updateRequired) {
    return (
      <div className="tw-h-full tw-flex tw-flex-col" ref={containerRef}>
        <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-flex-col">
          <SidebarHeader
            compactBadge={compactBadge}
            showSettings={false}
            onSettingsToggle={() => {}}
          />
          <div className="tw-flex-1 tw-flex tw-flex-col tw-justify-center">
            <UpdateRequiredCard />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="tw-h-full tw-flex tw-flex-col" ref={containerRef}>
      <Card className="tw-p-4 tw-text-foreground tw-h-full tw-flex tw-flex-col">
        <SidebarHeader
          compactBadge={compactBadge}
          showSettings={showSettings}
          onSettingsToggle={() => setShowSettings(!showSettings)}
        />
        {showSettings ? (
          <SettingsView />
        ) : (
          <div className="tw-flex tw-flex-col tw-flex-1 tw-overflow-hidden tw-space-y-4">
            <MaintenanceBanner />
            <DiscordLinkBanner />
            <GameStatusCard />
            <Tabs defaultValue="game" className="tw-w-full tw-flex-1 tw-flex tw-flex-col tw-overflow-hidden">
              <TabsList className="tw-w-full tw-flex-shrink-0">
                <TabsTrigger value="game" className="tw-flex-1">Game Infos</TabsTrigger>
                <TabsTrigger value="engine" className="tw-flex-1">Engine</TabsTrigger>
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

export function SidebarContent() {
  return (
    <AuthGuard>
      <AuthenticatedContent />
    </AuthGuard>
  );
}
