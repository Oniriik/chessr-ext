import { proxyWheelGet } from '@/lib/wheel-proxy';
export const dynamic = 'force-dynamic';
export const GET = (req: Request) => proxyWheelGet(req, '/admin/wheel/stats');
