/**
 * Rate Limiter for Auth
 * Protects against brute force attacks on signup/login
 * 5 failed attempts → 15 minute cooldown
 */

const STORAGE_KEY = 'chessr-auth-attempts';
const MAX_ATTEMPTS = 5;
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

interface AttemptRecord {
  attempts: number;
  lockedUntil: number | null;
}

async function getRecords(): Promise<Record<string, AttemptRecord>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ? JSON.parse(result[STORAGE_KEY]) : {};
}

async function saveRecords(records: Record<string, AttemptRecord>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(records) });
}

export async function isRateLimited(email: string): Promise<{ limited: boolean; minutesLeft?: number }> {
  const records = await getRecords();
  const record = records[email];

  if (!record?.lockedUntil) return { limited: false };

  if (Date.now() > record.lockedUntil) {
    // Lock expired, reset
    delete records[email];
    await saveRecords(records);
    return { limited: false };
  }

  const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / 1000 / 60);
  return { limited: true, minutesLeft };
}

export async function recordFailedAttempt(email: string): Promise<void> {
  const records = await getRecords();
  const record = records[email] || { attempts: 0, lockedUntil: null };

  record.attempts++;

  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + COOLDOWN_MS;
  }

  records[email] = record;
  await saveRecords(records);
}

export async function resetAttempts(email: string): Promise<void> {
  const records = await getRecords();
  delete records[email];
  await saveRecords(records);
}

export const RATE_LIMIT_ERROR = (minutes: number) =>
  `Too many failed attempts. Please try again in ${minutes} minute(s).`;
