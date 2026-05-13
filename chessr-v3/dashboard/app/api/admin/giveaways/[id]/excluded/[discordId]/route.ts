import { proxyMutate } from '@/lib/giveaway-api';
export const dynamic = 'force-dynamic';

type RouteCtx = { params: Promise<{ id: string; discordId: string }> };

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id, discordId } = await params;
  return proxyMutate(req, 'DELETE', `/admin/giveaway/${id}/exclude/${discordId}`);
}
