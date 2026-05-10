/**
 * System-message widget queue.
 *
 * Single floating widget bottom-left of the page. Handles a queue of
 * messages — one shown at a time, slides out on dismiss, slides the
 * next one in. Producers:
 *   - login triggers (free → claim trial CTA, trial-used → join discord)
 *   - admin broadcast over WS (`system_message` event from serveur)
 *   - how-to tips on first launch (deduped via localStorage)
 *
 * IDs are caller-provided so we don't show duplicates if the same
 * trigger fires twice. `dismissedIds` is in-memory only — the howto
 * scaffold uses its own localStorage key so dismissed tips stay
 * dismissed across reloads.
 */

import { create } from 'zustand';

export type WidgetActionKind =
  | { kind: 'discord-link' }
  | { kind: 'discord-join';        url: string }
  | { kind: 'open-url';             url: string }
  /** `tab` is `<screen>:<tab>` — App.tsx routes it. Recognised values:
   *    settings:account | settings:general | settings:engine | settings:suggestions
   *    game:game | game:engine | game:automove */
  | { kind: 'open-tab';             tab: string }
  /** Asks the background to open the dedicated Stream Mode tab. */
  | { kind: 'open-stream' }
  /** Toggles `layoutStore.editMode` in-place so the user can drag/pin
   *  panel sections. Opens the panel as a side-effect. */
  | { kind: 'toggle-edit-layout' }
  | { kind: 'dismiss' };

export interface SystemMessage {
  id: string;
  /** Tag used for visual treatment (icon, accent color). */
  category: 'info' | 'discord' | 'trial' | 'admin' | 'howto';
  title: string;
  body?: string;
  cta?: {
    label: string;
    action: WidgetActionKind;
  };
  /** Auto-dismiss after N ms. Omit to keep it pinned until clicked. */
  ttl?: number;
}

interface WidgetState {
  queue: SystemMessage[];
  current: SystemMessage | null;
  /** Append a message. No-ops if the same id is already queued or shown. */
  push: (msg: SystemMessage) => void;
  /** Drop the current message and pop the next one off the queue. */
  next: () => void;
  /** Clear by id whether it's current or queued. */
  remove: (id: string) => void;
}

export const useWidgetStore = create<WidgetState>((set, get) => ({
  queue: [],
  current: null,

  push: (msg) => {
    const { current, queue } = get();
    if (current?.id === msg.id) return;
    if (queue.some((m) => m.id === msg.id)) return;
    if (!current) {
      set({ current: msg });
      return;
    }
    // Override: new message takes the floor immediately. The displaced
    // message goes to the FRONT of the queue, so when the user dismisses
    // the new one (e.g. an error toast), the previous nudge resumes
    // rather than getting silently dropped.
    set({ current: msg, queue: [current, ...queue] });
  },

  next: () => {
    const { queue } = get();
    if (queue.length === 0) {
      set({ current: null });
      return;
    }
    const [head, ...rest] = queue;
    set({ current: head, queue: rest });
  },

  remove: (id) => {
    const { current, queue } = get();
    if (current?.id === id) {
      // Promote the next one if any.
      if (queue.length === 0) set({ current: null });
      else {
        const [head, ...rest] = queue;
        set({ current: head, queue: rest });
      }
      return;
    }
    set({ queue: queue.filter((m) => m.id !== id) });
  },
}));
