import { proxyGet, proxyMutate } from '@/lib/giveaway-api';
export const dynamic = 'force-dynamic';

export const GET  = (req: Request) => proxyGet(req, '/admin/giveaways');
export const POST = (req: Request) => proxyMutate(req, 'POST', '/admin/giveaway',
  (ctx) => ({ createdByUserId: ctx.user.id }));
