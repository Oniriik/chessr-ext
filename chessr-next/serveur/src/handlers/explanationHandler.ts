/**
 * Move explanation handler — calls GPT-4.1 nano via Vercel AI SDK
 */

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const model = openai("gpt-4.1-nano");

export interface MoveExplanationParams {
  fen: string;
  moveSan: string;
  moveUci: string;
  evaluation: number;
  mateScore?: number;
  winRate: number;
  pvSan: string[];
  playerColor: "white" | "black";
  moveHistory: string[];
  isMaia: boolean;
  targetElo?: number;
}

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

function formatContinuation(
  pvSan: string[],
  playerColor: "white" | "black",
): string {
  if (pvSan.length <= 1) return "None";
  // pvSan[0] is the suggested move (player), pvSan[1] is opponent response, pvSan[2] is player, etc.
  const opponentColor = playerColor === "white" ? "Black" : "White";
  const playerLabel = playerColor === "white" ? "White" : "Black";
  return pvSan
    .slice(1)
    .map((move, i) => {
      const label = i % 2 === 0 ? `${opponentColor}` : `${playerLabel}`;
      return `${label}: ${move}`;
    })
    .join(", ");
}

function buildUserPrompt(params: MoveExplanationParams): string {
  const history =
    params.moveHistory.length > 0
      ? params.moveHistory.join(" ")
      : "Starting position";
  const continuation = formatContinuation(params.pvSan, params.playerColor);
  const targetElo = params.targetElo || 1500;
  const playerLabel = params.playerColor === "white" ? "White" : "Black";
  const opponentLabel = params.playerColor === "white" ? "Black" : "White";

  return `FEN: ${params.fen}
Player color: ${playerLabel}
Opponent: ${opponentLabel}
Game so far: ${history}
Suggested move (${playerLabel}): ${params.moveSan}
Expected continuation: ${continuation}
Player rating: ${targetElo}

Explain why this move is strong for the player (${playerLabel}) at this rating level.`;
}

export async function handleExplainMove(
  params: MoveExplanationParams,
): Promise<string> {
  const userPrompt = buildUserPrompt(params);

  const { text } = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.4,
    maxOutputTokens: 200,
    topP: 0.9,
  });

  if (!text) {
    throw new Error("No explanation generated");
  }

  return text.trim();
}
