/**
 * Move explanation client — calls the server which proxies to LLM
 */

import { supabase } from './supabase';
import { SERVER_URL } from './config';

export interface MoveExplanationParams {
  fen: string;
  moveSan: string;
  moveUci: string;
  evaluation: number;
  mateScore?: number | null;
  winRate: number;
  pvSan: string[];
  playerColor: 'white' | 'black';
}

export interface ExplanationResponse {
  explanation: string;
  dailyUsage: number;
  dailyLimit: number;
}

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

export async function fetchMoveExplanation(
  params: MoveExplanationParams,
): Promise<ExplanationResponse> {
  const token = await getAuthToken();

  const response = await fetch(`${SERVER_URL}/api/explain-move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    if (response.status === 429) throw new Error('Daily limit reached');
    if (response.status === 403) throw new Error('Premium feature');
    throw new Error(`Server error: ${response.status}`);
  }

  const data = await response.json();
  return {
    explanation: data.explanation || '',
    dailyUsage: data.dailyUsage ?? 0,
    dailyLimit: data.dailyLimit ?? 50,
  };
}
