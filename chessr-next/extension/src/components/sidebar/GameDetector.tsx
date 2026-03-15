/**
 * Invisible component that runs all essential non-UI hooks.
 * Always mounted (even in streamer mode) so game detection,
 * auth, WebSocket, suggestions, and analysis keep running.
 */
import { useEffect } from 'react';
import { useGameDetection } from '../../hooks/useGameDetection';
import { useSuggestionTrigger } from '../../hooks/useSuggestionTrigger';
import { useAnalysisTrigger } from '../../hooks/useAnalysisTrigger';
import { useOpeningTrigger } from '../../hooks/useOpeningTrigger';
import { useAuthStore } from '../../stores/authStore';
import { useWebSocketStore } from '../../stores/webSocketStore';

export function GameDetector() {
  const { user, initialize } = useAuthStore();
  const { init: initWebSocket, connect: connectWebSocket, destroy: destroyWebSocket } = useWebSocketStore();

  // Initialize auth
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Initialize and connect WebSocket when authenticated
  useEffect(() => {
    if (user) {
      initWebSocket();
      connectWebSocket();
    }
    return () => {
      destroyWebSocket();
    };
  }, [user, initWebSocket, connectWebSocket, destroyWebSocket]);

  useGameDetection();
  useSuggestionTrigger();
  useAnalysisTrigger();
  useOpeningTrigger();

  return null;
}
