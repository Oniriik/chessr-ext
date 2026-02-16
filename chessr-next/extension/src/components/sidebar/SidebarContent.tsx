import { AuthGuard } from '../auth';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { LogOut, X } from 'lucide-react';
import { GameStatusCard } from './GameStatusCard';
import { EloSettings } from './EloSettings';
import { PersonalitySelect } from './PersonalitySelect';
import { PlanBadge } from '../ui/plan-badge';
import { useGameDetection } from '../../hooks/useGameDetection';
import { useSidebar } from '../../hooks/useSidebar';
import { useContainerWidth } from '../../hooks/useContainerWidth';

/**
 * SIDEBAR COMPONENTS ARCHITECTURE
 * ================================
 *
 * IMPORTANT: Maximize component extraction for the sidebar elements.
 * Each UI block should be its own reusable component.
 *
 * Planned sections & components to create:
 *
 * 1. ELO SETTINGS SECTION
 *    - EloDisplay          → Shows TARGET ELO / OPPONENT ELO header values
 *    - EloSlider           → Reusable slider with Auto checkbox, value display
 *    - MaxEloPowerToggle   → Toggle for unlocking max engine strength (3500 ELO)
 *
 * 2. ANALYSIS SECTION
 *    - RollingAccuracy     → Accuracy % with trend arrow + plies count
 *    - MoveStatsGrid       → Grid showing !!, !, Best, Exc, Good, Book, ?!, ?, ??
 *    - MoveSuggestionList  → List of suggested moves
 *    - MoveSuggestionCard  → Individual move with rank, name, eval, quality badges, effects
 *    - QualityBadge        → Reusable badge (Best, Safe, Risky, etc.)
 *    - EffectIcon          → Icons for captures, checks, etc.
 *
 * Components should be placed in: src/components/sidebar/
 * Keep components small, focused, and reusable.
 */

function SidebarHeader({ compactBadge }: { compactBadge: boolean }) {
  const { signOut } = useAuthStore();
  const { toggle } = useSidebar();

  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-mb-4">
      <div className="tw-flex tw-items-center tw-gap-2">
        <img
          src={chrome.runtime.getURL('icons/icon48.png')}
          alt="Chessr"
          className="tw-w-8 tw-h-8"
        />
        <span className="tw-text-lg tw-font-semibold tw-mr-2">Chessr.io</span>
        <PlanBadge plan="beta" compact={compactBadge} />
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
  // Initialize game detection (waits for move list, observes changes)
  useGameDetection();
  const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
  const compactBadge = containerWidth > 0 && containerWidth < 350;

  return (
    <div className="tw-h-full" ref={containerRef}>
      <Card className="tw-p-4 tw-text-foreground tw-h-full tw-space-y-4">
        <SidebarHeader compactBadge={compactBadge} />
        <GameStatusCard />
        <EloSettings />
        <PersonalitySelect />
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
