import { WS_SERVER_URL } from './config';

type MessageHandler = (data: any) => void;

let ws: WebSocket | null = null;
let userId: string | null = null;
let pendingMessage: any = null;
const handlers = new Set<MessageHandler>();

export function connectWs(uid: string) {
  if (!uid || typeof uid !== 'string' || uid === 'undefined' || uid === 'null') {
    console.warn('[Unlocker][WS] connectWs called with invalid uid:', uid);
    return;
  }
  if (ws && userId === uid && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }
  if (ws && userId !== uid) {
    try { ws.onclose = null; ws.close(); } catch {}
    ws = null;
  }
  userId = uid;

  const url = `${WS_SERVER_URL}/ws?userId=${encodeURIComponent(uid)}`;
  console.log('[Unlocker][WS] opening:', url);
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[Unlocker][WS] open ok for', uid);
    if (pendingMessage) {
      ws!.send(JSON.stringify(pendingMessage));
      pendingMessage = null;
    }
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      for (const handler of handlers) handler(data);
    } catch {}
  };

  ws.onclose = (ev) => {
    console.warn('[Unlocker][WS] closed', { code: ev.code, reason: ev.reason });
    setTimeout(() => {
      if (userId && (!ws || ws.readyState === WebSocket.CLOSED)) connectWs(userId);
    }, 3000);
  };
}

export function sendWs(data: any) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  } else {
    pendingMessage = data;
  }
}

export function onWsMessage(handler: MessageHandler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function disconnectWs() {
  userId = null;
  ws?.close();
  ws = null;
}
