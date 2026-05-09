/**
 * Dashboard → serveur events emitter.
 *
 * The dashboard's API routes (ban/unban/plan PATCH/delete/etc.) call
 * `emitEvent()` after a successful Supabase mutation. The serveur is
 * the only writer to the analytics DB + Redis, so we proxy through
 * `POST /admin/events` rather than wiring a second analytics DB
 * connection into the Next.js container.
 *
 * Failures are caught and logged — telemetry should never roll back the
 * mutation that prompted it. Same trade-off as the serveur-side helper.
 */

const VALID_TYPES = [
  'plan_changed',
  'user_banned',
  'user_unbanned',
  'user_deleted',
  'discord_linked',
  'discord_unlinked',
  'chess_account_linked',
  'chess_account_unlinked',
  'role_changed',
  'email_changed',
] as const;
export type EventType = (typeof VALID_TYPES)[number];

export interface EmitEventArgs {
  type: EventType;
  user_id?: string | null;
  actor_id?: string | null;
  payload?: Record<string, unknown>;
}

export async function emitEvent(args: EmitEventArgs): Promise<void> {
  const serveurUrl = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) {
    console.warn('[events] SERVEUR_ADMIN_TOKEN not set — event dropped:', args.type);
    return;
  }

  try {
    const res = await fetch(`${serveurUrl}/admin/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      console.warn('[events] serveur replied', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.warn(
      '[events] failed to emit:',
      args.type,
      err instanceof Error ? err.message : err,
    );
  }
}
