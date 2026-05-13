import { proxyGet, proxyMutate } from '@/lib/giveaway-api';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  return proxyGet(req, `/admin/giveaway/${id}/excluded`);
}

export async function POST(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  // actorUserId so the serveur audit knows who pushed the exclude.
  return proxyMutate(req, 'POST', `/admin/giveaway/${id}/exclude`, (ctx) => ({
    actorUserId: ctx.user.id,
  }));
}
