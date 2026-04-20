import { create } from 'zustand';
import { sendWs, onWsMessage } from '../lib/websocket';

interface ReviewHeaders {
  White?: string | null;
  Black?: string | null;
  Result?: string | null;
}

interface ReviewState {
  gameId: string | null;
  loading: boolean;
  checking: boolean;
  progress: number;
  analysis: any | null;
  headers: ReviewHeaders | null;
  error: string | null;

  checkCache: (gameId: string) => void;
  requestReview: (gameId: string) => void;
  reset: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  gameId: null,
  loading: false,
  checking: false,
  progress: 0,
  analysis: null,
  headers: null,
  error: null,

  checkCache: (gameId: string) => {
    if (get().gameId === gameId) return;
    set({ gameId, checking: true, loading: false, progress: 0, analysis: null, headers: null, error: null });
    sendWs({
      type: 'chesscom_review',
      requestId: `review-${gameId}`,
      gameId,
      gameType: 'live',
      cacheOnly: true,
    });
  },

  requestReview: (gameId: string) => {
    const requestId = `review-${gameId}`;
    set({ gameId, loading: true, checking: false, progress: 0, analysis: null, headers: null, error: null });
    sendWs({
      type: 'chesscom_review',
      requestId,
      gameId,
      gameType: 'live',
    });
  },

  reset: () => set({ gameId: null, loading: false, checking: false, progress: 0, analysis: null, headers: null, error: null }),
}));

// WS listener
onWsMessage((data) => {
  const state = useReviewStore.getState();
  if (!state.gameId) return;
  const expectedReqId = `review-${state.gameId}`;
  if (data.requestId !== expectedReqId) return;

  switch (data.type) {
    case 'chesscom_review_progress':
      useReviewStore.setState({ progress: data.progress || 0 });
      break;
    case 'chesscom_review_result':
      useReviewStore.setState({ loading: false, checking: false, progress: 100, analysis: data.analysis, headers: data.headers || null });
      break;
    case 'chesscom_review_cache_miss':
      useReviewStore.setState({ checking: false });
      break;
    case 'chesscom_review_error':
      useReviewStore.setState({ loading: false, checking: false, error: data.error || 'Review failed' });
      break;
  }
});
