import { Hono } from 'hono';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { supabase } from '../lib/supabase.js';

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = openai('gpt-4.1-nano');

const DAILY_LIMIT = 50;
const PREMIUM_PLANS = ['premium', 'lifetime', 'beta', 'freetrial'];

const SYSTEM_PROMPT = `You are an elite human chess coach explaining a suggested move to the player.

The player plays as the specified color. The suggested move is the player's next move.
The expected continuation alternates between the opponent's response and the player's reply.

Explain the suggested move in 2–3 concise sentences (max 60 words).

Include:
- Main idea of the move
- Concrete threat or improvement it creates
- What the expected continuation achieves (distinguish the player's moves from the opponent's responses)
- A short long-term plan

**Bold** key motifs like fork, pin, outpost, initiative.

Be practical and human. No engine tone.
Do not repeat the move name or mention evaluation numbers.
Avoid generic statements.`;

interface ExplainBody {
  fen: string;
  moveSan: string;
  moveUci: string;
  evaluation: number;
  mateScore?: number | null;
  winRate: number;
  pvSan: string[];
  playerColor: 'white' | 'black';
}

function formatContinuation(pvSan: string[], playerColor: string): string {
  if (pvSan.length <= 1) return 'None';
  const opponent = playerColor === 'white' ? 'Black' : 'White';
  const player = playerColor === 'white' ? 'White' : 'Black';
  return pvSan
    .slice(1)
    .map((move, i) => `${i % 2 === 0 ? opponent : player}: ${move}`)
    .join(', ');
}

export const explanationRoutes = new Hono();

explanationRoutes.post('/api/explain-move', async (c) => {
  // Auth
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return c.json({ error: 'Authentication required' }, 401);

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return c.json({ error: 'Invalid token' }, 401);

  const userId = authData.user.id;

  // Premium check
  const { data: settings } = await supabase
    .from('user_settings')
    .select('plan')
    .eq('user_id', userId)
    .single();

  if (!PREMIUM_PLANS.includes(settings?.plan || 'free')) {
    return c.json({ error: 'Premium feature' }, 403);
  }

  // Daily limit
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('user_activity')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'explanation')
    .gte('created_at', todayUTC.toISOString());

  const currentUsage = count || 0;
  if (currentUsage >= DAILY_LIMIT) {
    return c.json({ error: 'Daily limit reached', dailyUsage: DAILY_LIMIT, dailyLimit: DAILY_LIMIT }, 429);
  }

  // Generate
  const body = await c.req.json<ExplainBody>();
  const player = body.playerColor === 'white' ? 'White' : 'Black';
  const continuation = formatContinuation(body.pvSan, body.playerColor);

  const userPrompt = `FEN: ${body.fen}
Player color: ${player}
Suggested move (${player}): ${body.moveSan}
Expected continuation: ${continuation}

Explain why this move is strong for the player (${player}).`;

  console.log(`[Explain] ${authData.user.email} → ${body.moveSan} [${currentUsage + 1}/${DAILY_LIMIT}]`);

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.4,
    maxOutputTokens: 200,
  });

  if (!text) return c.json({ error: 'No explanation generated' }, 500);

  // Log usage
  await supabase.from('user_activity').insert({ user_id: userId, event_type: 'explanation' });

  return c.json({
    explanation: text.trim(),
    dailyUsage: currentUsage + 1,
    dailyLimit: DAILY_LIMIT,
  });
});
