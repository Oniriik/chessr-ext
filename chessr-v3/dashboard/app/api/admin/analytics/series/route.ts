import { proxyGet } from '@/lib/giveaway-api';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return proxyGet(req, '/admin/analytics/series');
}
