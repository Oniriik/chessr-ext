import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWebSocketStore } from '../../stores/webSocketStore';
import { useAccountsFetched } from '../../stores/linkedAccountsStore';
import { useSuggestionTrigger } from '../../hooks/useSuggestionTrigger';
import { useAnalysisTrigger } from '../../hooks/useAnalysisTrigger';
import { useArrowRenderer } from '../../hooks/useArrowRenderer';
import { useEvalBar } from '../../hooks/useEvalBar';
import { useLinkingCheck } from '../../hooks/useLinkingCheck';
import { AuthForm } from './AuthForm';
import { LinkAccountModal } from '../LinkAccountModal';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, initializing, initialize } = useAuthStore();
  const { isConnected, init: initWebSocket, connect: connectWebSocket, destroy: destroyWebSocket } = useWebSocketStore();
  const accountsFetched = useAccountsFetched();

  // Initialize auth
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Initialize and connect WebSocket when user is authenticated
  useEffect(() => {
    if (user) {
      initWebSocket();
      connectWebSocket();
    }

    return () => {
      destroyWebSocket();
    };
  }, [user, initWebSocket, connectWebSocket, destroyWebSocket]);

  // Auto-trigger suggestions on player turn
  useSuggestionTrigger();

  // Auto-trigger analysis after player moves
  useAnalysisTrigger();

  // Draw suggestion arrows on board
  useArrowRenderer();

  // Show eval bar next to board
  useEvalBar();

  // Check if user needs to link their platform account
  const { shouldShowLinkModal } = useLinkingCheck();

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

  return <>{children}</>;
}
