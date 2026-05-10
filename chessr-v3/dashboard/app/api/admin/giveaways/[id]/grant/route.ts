import { proxyMutate } from '@/lib/giveaway-api';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  // The serveur logs `actorUserId` for the audit row + emitted event.
  return proxyMutate(req, 'POST', `/admin/giveaway/${id}/tickets/grant`,
    (ctx) => ({ actorUserId: ctx.user.id }));
}
