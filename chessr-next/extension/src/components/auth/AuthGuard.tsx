import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useWebSocketStore } from '../../stores/webSocketStore';
import { AuthForm } from './AuthForm';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, initializing, initialize } = useAuthStore();
  const { init: initWebSocket, connect: connectWebSocket, destroy: destroyWebSocket } = useWebSocketStore();

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

  if (initializing) {
    return (
      <div className="tw-flex tw-items-center tw-justify-center tw-h-full tw-min-h-[200px]">
        <Loader2 className="tw-w-6 tw-h-6 tw-animate-spin tw-text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return <>{children}</>;
}
