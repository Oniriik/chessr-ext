import { proxyGet, proxyMutate } from '@/lib/giveaway-api';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  return proxyGet(req, `/admin/giveaway/${id}`);
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  return proxyMutate(req, 'PATCH', `/admin/giveaway/${id}`);
}
