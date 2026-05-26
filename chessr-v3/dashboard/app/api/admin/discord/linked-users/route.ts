import { NextResponse } from 'next/server';
import { requireAdmin, isAdminContext } from '@/lib/auth-guard';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (!isAdminContext(ctx)) return ctx;

  const url = new URL(req.url);
  const search = url.searchParams.get('search') ?? '';

  const { data: settings } = await ctx.supabase
    .from('user_settings')
    .select('user_id, discord_id, discord_username, discord_avatar, plan')
    .not('discord_id', 'is', null)
    .order('discord_linked_at', { ascending: false })
    .limit(200);

  if (!settings?.length) return NextResponse.json({ users: [] });

  // Fetch emails for all discord-linked users via admin auth API.
  const emails = new Map<string, string>();
  let page = 1;
  while (true) {
    const { data: { users: batch } } = await ctx.supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (!batch.length) break;
    for (const u of batch) if (u.email) emails.set(u.id, u.email);
    if (batch.length < 1000) break;
    page++;
  }

  let users = settings.map((s) => ({
    userId:          s.user_id          as string,
    discordId:       s.discord_id       as string,
    discordUsername: (s.discord_username as string | null) ?? null,
    discordAvatar:   (s.discord_avatar  as string | null) ?? null,
    email:           emails.get(s.user_id as string) ?? null,
    plan:            (s.plan            as string | null) ?? 'free',
  }));

  if (search) {
    const q = search.toLowerCase();
    users = users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.discordUsername?.toLowerCase().includes(q) ||
        u.discordId.includes(q),
    );
  }

  return NextResponse.json({ users });
}
