import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWebSocketStore } from '../../stores/webSocketStore';
import { useAccountsFetched } from '../../stores/linkedAccountsStore';
import { useArrowRenderer } from '../../hooks/useArrowRenderer';
import { useEvalBar } from '../../hooks/useEvalBar';
import { useLinkingCheck } from '../../hooks/useLinkingCheck';
import { AuthForm } from './AuthForm';
import { LinkAccountModal } from '../LinkAccountModal';
import { GiveawayModal } from '../GiveawayModal';
import { useDiscordStore } from '../../stores/discordStore';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, initializing, initialize } = useAuthStore();

  const { isConnected, init: initWebSocket, connect: connectWebSocket } = useWebSocketStore();

  // Ensure auth is initialized regardless of which route/page we're on
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Connect WebSocket when authenticated (so it works on all pages, not just game routes)
  useEffect(() => {
    if (user) {
      initWebSocket();
      connectWebSocket();
    }
  }, [user, initWebSocket, connectWebSocket]);
  const accountsFetched = useAccountsFetched();

  // Draw suggestion arrows on board (UI-only, hidden in streamer mode)
  useArrowRenderer();

  // Show eval bar next to board (UI-only, hidden in streamer mode)
  useEvalBar();

  // Check if user needs to link their platform account
  const { shouldShowLinkModal } = useLinkingCheck();

  // Giveaway modal state
  const activeGiveaway = useDiscordStore((s) => s.activeGiveaway);
  const giveawayDismissed = useDiscordStore((s) => s.giveawayDismissed);

  // Show loading while initializing auth
  if (initializing) {
    return (
      <div className="tw-flex tw-items-center tw-justify-center tw-h-full tw-min-h-[200px]">
        <Loader2 className="tw-w-6 tw-h-6 tw-animate-spin tw-text-primary" />
      </div>
    );
  }

  // Show auth form if not logged in
  if (!user) {
    return <AuthForm />;
  }

  // Wait for WebSocket connection and linked accounts to be fetched
  // This prevents the UI from flashing before showing the link modal
  if (!isConnected || !accountsFetched) {
    return (
      <div className="tw-flex tw-items-center tw-justify-center tw-h-full tw-min-h-[200px]">
        <Loader2 className="tw-w-6 tw-h-6 tw-animate-spin tw-text-primary" />
      </div>
    );
  }

  // Show link modal if user needs to link their account
  if (shouldShowLinkModal) {
    return <LinkAccountModal />;
  }

  // Show giveaway modal if active giveaway and user not in Discord
  const showGiveaway = activeGiveaway && !giveawayDismissed;

  return (
    <>
      {showGiveaway && <GiveawayModal />}
      {children}
    </>
  );
}
