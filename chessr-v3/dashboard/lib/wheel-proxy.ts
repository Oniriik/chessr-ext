import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

/**
 * Shared GET-proxy for /admin/wheel/* read-only endpoints. The dashboard
 * routes that just forward query-string + admin token to the serveur
 * call this and stay one-liner. Anything that needs role gating beyond
 * basic admin (e.g. apply-lifetime, grant) doesn't use this — it
 * implements its own handler.
 */
export async function proxyWheelGet(
  req: Request,
  serveurPath: `/admin/wheel/${string}`,
): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const incomingUrl = new URL(req.url);
  const qs = incomingUrl.searchParams.toString();

  const serveur = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
  const adminToken = process.env.SERVEUR_ADMIN_TOKEN || '';
  if (!adminToken) {
    return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });
  }
  const target = `${serveur}${serveurPath}${qs ? `?${qs}` : ''}`;

  const res = await fetch(target, {
    headers: { 'x-admin-token': adminToken },
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
