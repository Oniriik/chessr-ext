import { WS_SERVER_URL } from './config';
import { recordWsSend, recordWsRecv } from './diagBuffer';

type MessageHandler = (data: any) => void;

let ws: WebSocket | null = null;
let userId: string | null = null;
let pendingMessage: any = null;
const handlers = new Set<MessageHandler>();

export function connectWs(uid: string) {
  // Dedupe: skip if an active (CONNECTING or OPEN) socket already exists for this user.
  if (ws && userId === uid && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }
  // Different user → close the old socket cleanly before opening a new one.
  if (ws && userId !== uid) {
    try { ws.onclose = null; ws.close(); } catch {}
    ws = null;
  }
  userId = uid;

  ws = new WebSocket(`${WS_SERVER_URL}/ws?userId=${uid}`);

  ws.onopen = () => {
    if (pendingMessage) {
      ws!.send(JSON.stringify(pendingMessage));
      pendingMessage = null;
    }
  };

  ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      recordWsRecv(data);
      for (const handler of handlers) handler(data);
    } catch {}
  };

  ws.onclose = () => {
    // Only retry if we still intend to be connected (userId set)
    setTimeout(() => {
      if (userId && (!ws || ws.readyState === WebSocket.CLOSED)) connectWs(userId);
    }, 3000);
  };
}

export function sendWs(data: any) {
  recordWsSend(data);
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
