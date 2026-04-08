import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthGuard } from '../auth';
import { useAuthStore } from '../../stores/authStore';
import { useVersionStore } from '../../stores/versionStore';
import { useSidebarStore } from '../../stores/sidebarStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { LogOut, X, Settings, ArrowLeft } from 'lucide-react';
import { MaintenanceBanner } from './MaintenanceBanner';
import { DiscordLinkBanner } from './DiscordLinkBanner';
import { TipsBanner } from './TipsBanner';
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
import { UpgradeModal } from '../UpgradeModal';
import { useSidebar } from '../../hooks/useSidebar';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { useHotkeyMove } from '../../hooks/useHotkeyMove';

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
  const { t } = useTranslation(['common', 'game']);
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
              title={t('common:back')}
            >
              <ArrowLeft className="tw-h-4 tw-w-4" />
            </Button>
            <span className="tw-text-lg tw-font-semibold">{t('common:settings')}</span>
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
              title={t('common:settings')}
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
          title={t('common:signOut')}
        >
          <LogOut className="tw-h-4 tw-w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className="tw-h-8 tw-w-8"
          title={t('common:closeSidebar')}
        >
          <X className="tw-h-4 tw-w-4" />
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedContent() {
  const { t } = useTranslation(['common', 'game']);
  useHotkeyMove();

  // Check version on mount
  const { updateRequired, checkVersion } = useVersionStore();
  useEffect(() => {
    checkVersion();
  }, [checkVersion]);

  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const compactBadge = containerWidth > 0 && containerWidth < 350;
  const showSettings = useSidebarStore((s) => s.showSettings);
  const setShowSettings = useSidebarStore((s) => s.setShowSettings);

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
            <TipsBanner />
            <GameStatusCard />
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

export function SidebarContent() {
  return (
    <AuthGuard>
      <AuthenticatedContent />
      <UpgradeModal />
    </AuthGuard>
  );
}
