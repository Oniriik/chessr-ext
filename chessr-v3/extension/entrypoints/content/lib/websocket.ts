import { WS_SERVER_URL } from './config';

type MessageHandler = (data: any) => void;

let ws: WebSocket | null = null;
let userId: string | null = null;
let pendingMessage: any = null;
const handlers = new Set<MessageHandler>();

export function connectWs(uid: string) {
  if (ws?.readyState === WebSocket.OPEN) return;
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
      for (const handler of handlers) handler(data);
    } catch {}
  };

  ws.onclose = () => {
    setTimeout(() => { if (userId) connectWs(userId); }, 3000);
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
