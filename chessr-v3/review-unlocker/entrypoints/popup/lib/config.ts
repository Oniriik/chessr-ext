const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8081';

export const SERVER_URL = WS_URL.replace(/^ws/, 'http');
export const WS_SERVER_URL = WS_URL;

export const APP_REVIEW_URL = (gameId: string) => `https://app.chessr.io/review/${gameId}`;
