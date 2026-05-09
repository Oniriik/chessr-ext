import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

interface SystemMessage {
  id: string;
  category: 'info' | 'discord' | 'trial' | 'admin' | 'howto';
  title: string;
  body?: string;
  cta?: {
    label: string;
    action:
      | { kind: 'discord-link' }
      | { kind: 'discord-join'; url: string }
      | { kind: 'open-url'; url: string }
      | { kind: 'open-tab'; tab: string }
      | { kind: 'dismiss' };
  };
  ttl?: number;
}

export async function POST(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const body = await req.json().catch(() => ({}));
  const recipients = body.recipients as 'all' | string[] | undefined;
  const message = body.message as SystemMessage | undefined;

  if (!message?.id || !message?.title || !message?.category) {
    return NextResponse.json({ error: 'message.id, title, category required' }, { status: 400 });
  }
  if (recipients !== 'all' && !Array.isArray(recipients)) {
    return NextResponse.json({ error: 'recipients must be "all" or string[]' }, { status: 400 });
  }

  // Proxy to the serveur, which owns the WS connection registry.
  const serveurUrl = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  const res = await fetch(`${serveurUrl}/admin/system-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': adminToken,
    },
    body: JSON.stringify({ recipients, message }),
  });
  const json = await res.json().catch(() => ({}));
  return NextResponse.json(json, { status: res.status });
}
