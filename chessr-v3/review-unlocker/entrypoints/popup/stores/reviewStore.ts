import { create } from 'zustand';
import { sendWs, onWsMessage } from '../lib/websocket';

interface ReviewHeaders {
  White?: string | null;
  Black?: string | null;
  Result?: string | null;
}

/** Daily-review quota snapshot returned by the server alongside every
 *  review response. Null for users with no auth context; `isPremium=true`
 *  when the plan is unlimited (in which case usage/limit are null). */
export interface ReviewQuota {
  dailyUsage: number | null;
  dailyLimit: number | null;
  isPremium: boolean;
}

interface ReviewState {
  gameId: string | null;
  loading: boolean;
  checking: boolean;
  progress: number;
  analysis: any | null;
  headers: ReviewHeaders | null;
  error: string | null;
  quota: ReviewQuota | null;

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
  quota: null,

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
    set({ gameId, loading: true, checking: false, progress: 0, analysis: null, headers: null, error: null });
    sendWs({
      type: 'chesscom_review',
      requestId: `review-${gameId}`,
      gameId,
      gameType: 'live',
    });
  },

  reset: () => set({
    gameId: null, loading: false, checking: false, progress: 0,
    analysis: null, headers: null, error: null,
  }),
}));

/** Pull the quota fields out of a server response (if present) and store
 *  them. Server includes these on cache_hit, cache_miss, and error. */
function captureQuota(data: any) {
  if (typeof data.dailyUsage === 'undefined' && typeof data.dailyLimit === 'undefined' && typeof data.isPremium === 'undefined') return;
  useReviewStore.setState({
    quota: {
      dailyUsage: data.dailyUsage ?? null,
      dailyLimit: data.dailyLimit ?? null,
      isPremium: !!data.isPremium,
    },
  });
}

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
      useReviewStore.setState({
        loading: false, checking: false, progress: 100,
        analysis: data.analysis, headers: data.headers || null,
      });
      captureQuota(data);
      break;
    case 'chesscom_review_cache_miss':
      useReviewStore.setState({ checking: false });
      captureQuota(data);
      break;
    case 'chesscom_review_error':
      useReviewStore.setState({
        loading: false, checking: false,
        error: data.error || 'Review failed',
      });
      captureQuota(data);
      break;
  }
});
