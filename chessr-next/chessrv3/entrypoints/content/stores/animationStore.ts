/**
 * animationStore — Centralized animation gate.
 *
 * markEvent(key) — called when real data arrives
 * consumeEvent(key, consumerId) — returns true once per consumer per event
 *
 * Multiple components can consume the same event independently.
 */

import { useSettingsStore } from './settingsStore';

// event key → timestamp
const events: Record<string, number> = {};
// "key:consumerId" → last consumed timestamp
const consumed: Record<string, number> = {};

export const animationGate = {
  markEvent(key: string) {
    events[key] = Date.now();
  },

  consumeEvent(key: string, consumerId = 'default'): boolean {
    if (useSettingsStore.getState().disableAnimations) return false;

    const eventTime = events[key] || 0;
    const consumeKey = `${key}:${consumerId}`;
    const lastConsumed = consumed[consumeKey] || 0;

    if (eventTime > lastConsumed) {
      consumed[consumeKey] = Date.now();
      return true;
    }

    return false;
  },
};
