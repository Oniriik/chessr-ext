/**
 * Move explanation client — calls the server which proxies to GPT-4.1 nano via Vercel AI SDK
 */

import { supabase } from './supabase';

const SERVER_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http');

export interface MoveExplanationParams {
  fen: string;
  moveSan: string;
  moveUci: string;
  evaluation: number;
  mateScore?: number;
  winRate: number;
  pvSan: string[];
  playerColor: 'white' | 'black';
  moveHistory: string[];
  isMaia: boolean;
  targetElo?: number;
}

export interface ExplanationResponse {
  explanation: string;
  dailyUsage: number;
  dailyLimit: number;
}

export interface ExplanationUsageResponse {
  dailyUsage: number;
  dailyLimit: number;
  isPremium: boolean;
}

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not authenticated');
  return token;
}

export async function fetchMoveExplanation(
  params: MoveExplanationParams
): Promise<ExplanationResponse> {
  const token = await getAuthToken();

  const response = await fetch(`${SERVER_URL}/api/explain-move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => null);
    if (response.status === 401) {
      throw new Error('Authentication expired, please refresh');
    }
    if (response.status === 403) {
      throw new Error('Move explanations are a premium feature');
    }
    if (response.status === 429) {
      throw new Error('Daily limit reached (50/day)');
    }
    throw new Error(err?.error || `Server error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.explanation) {
    throw new Error('No explanation generated');
  }

  return {
    explanation: data.explanation,
    dailyUsage: data.dailyUsage ?? 0,
    dailyLimit: data.dailyLimit ?? 50,
  };
}

export async function fetchExplanationUsage(): Promise<ExplanationUsageResponse> {
  const token = await getAuthToken();

  const response = await fetch(`${SERVER_URL}/api/explanation-usage`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return { dailyUsage: 0, dailyLimit: 0, isPremium: false };
  }

  const data = await response.json();
  return {
    dailyUsage: data.dailyUsage ?? 0,
    dailyLimit: data.dailyLimit ?? 0,
    isPremium: data.isPremium ?? false,
  };
}
