/**
 * Server-side helper for the giveaway admin routes. Mirrors the Hono
 * endpoints exposed by the serveur.
 *
 *   GET  → proxy admin auth + serveur token
 *   POST/PATCH/PUT/DELETE → enforce super_admin at the route layer,
 *                           then proxy
 */

import { NextResponse } from 'next/server';
import { type AdminContext, isAdminContext, requireAdmin } from '@/lib/auth-guard';

const SERVEUR = process.env.NEXT_PUBLIC_SERVEUR_URL || 'http://localhost:8081';
const ADMIN_TOKEN = process.env.SERVEUR_ADMIN_TOKEN || '';

function adminHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json', 'x-admin-token': ADMIN_TOKEN };
}

/** Bearer-token-gated GET passthrough. */
export async function proxyGet(req: Request, path: string): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  if (!ADMIN_TOKEN) return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });

  const incoming = new URL(req.url);
  // Drop the dashboard auth `token` from the qs — the serveur uses
  // x-admin-token instead and would reject the param.
  incoming.searchParams.delete('token');
  const qs = incoming.searchParams.toString();
  const target = `${SERVEUR}${path}${qs ? `?${qs}` : ''}`;

  const res = await fetch(target, { headers: { 'x-admin-token': ADMIN_TOKEN } });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

/** Mutation passthrough — gated to super_admin. */
export async function proxyMutate(
  req: Request,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  bodyExtras: (ctx: AdminContext) => Record<string, unknown> = () => ({}),
): Promise<Response> {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;
  if (ctx.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin required' }, { status: 403 });
  }
  if (!ADMIN_TOKEN) return NextResponse.json({ error: 'serveur token missing' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const merged = { ...body, ...bodyExtras(ctx) };

  const res = await fetch(`${SERVEUR}${path}`, {
    method,
    headers: adminHeaders(),
    body: JSON.stringify(merged),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
