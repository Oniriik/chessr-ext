/**
 * Static catalog of how-to / tip messages.
 *
 * The extension picks the first ID NOT in the dismissed set and pushes
 * it to the system-message widget on login. Dismissed IDs are stored in
 * `localStorage[DISMISSED_KEY]`. Adding a new tip is just appending to
 * `HOW_TOS` — no migration needed.
 *
 * Each tip's `cta.action.tab` must match a known tab id in App.tsx (the
 * dispatcher listens for the `chessr:open-tab` event and routes there).
 * For now the list is a placeholder pair; real entries land later.
 */

import type { SystemMessage } from '../stores/widgetStore';

export type HowToMessage = SystemMessage & { id: `howto-${string}`; category: 'howto' };

// Order matters — this is the rotation order. The first un-dismissed
// tip wins on each new session. Keep the most onboarding-relevant tips
// near the top.
export const HOW_TOS: HowToMessage[] = [
  {
    id: 'howto-engine',
    category: 'howto',
    title: 'Tired of komodo?',
    body: 'chessr ships Komodo Dragon, Maia 2 & Maia 3. Pick the one that matches your style.',
    cta: { label: 'Pick my engine', action: { kind: 'open-tab', tab: 'settings:engine' } },
  },
  {
    id: 'howto-hotkeys',
    category: 'howto',
    title: 'Play with your keyboard',
    body: '1, 2, 3 to play moves. Hold Shift to queue the next one as a premove during your opponent\'s turn.',
    cta: { label: 'Set my hotkeys', action: { kind: 'open-tab', tab: 'game:automove' } },
  },
  {
    id: 'howto-onscreen',
    category: 'howto',
    title: 'Don\'t like keyboard?',
    body: 'Toggle on-screen buttons — three taps and you\'re moving, no shortcut to memorize.',
    cta: { label: 'Show me', action: { kind: 'open-tab', tab: 'game:automove' } },
  },
  {
    id: 'howto-stream',
    category: 'howto',
    title: 'Streaming?',
    body: 'Stream Mode opens a dedicated tab with your board + eval. Your audience never sees the suggestion arrows.',
    cta: { label: 'Open Stream Mode', action: { kind: 'open-stream' } },
  },
  {
    id: 'howto-profile-analysis',
    category: 'howto',
    title: 'Want to stay undetected?',
    body: 'chessr scans your profile and flags what looks fishy to chess.com — then tells you exactly how to clean it up.',
    cta: { label: 'Run the analysis', action: { kind: 'open-url', url: 'https://app.chessr.io' } },
  },
  {
    id: 'howto-review',
    category: 'howto',
    title: 'No chess.com Diamond? No problem.',
    body: 'Get a full coached chess.com review of your last game on us — past games too at app.chessr.io.',
    cta: { label: 'Review my game', action: { kind: 'open-url', url: 'https://app.chessr.io' } },
  },
  {
    id: 'howto-layout',
    category: 'howto',
    title: 'Make it yours',
    body: 'Drag, pin, reorder — chessr\'s panel sections snap where you want them.',
    cta: { label: 'Edit my layout', action: { kind: 'toggle-edit-layout' } },
  },
];

const DISMISSED_KEY = 'chessr:dismissed-howtos';

export function getDismissedIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

export function markDismissed(id: string): void {
  if (typeof localStorage === 'undefined') return;
  const set = getDismissedIds();
  set.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(set)));
}

/** Returns the first not-yet-dismissed tip, or null when the user has
 *  seen everything. */
export function pickNextHowTo(): HowToMessage | null {
  const dismissed = getDismissedIds();
  for (const tip of HOW_TOS) {
    if (!dismissed.has(tip.id)) return tip;
  }
  return null;
}
