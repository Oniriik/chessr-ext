/**
 * HotkeyMoveButtons — floating row of buttons that trigger the same
 * action as pressing the configured hotkey for a given suggestion slot.
 *
 * Independent of the panel / FAB. Renders only when:
 *   - mode === 'hotkey'
 *   - useOnScreenButtons toggle is on
 *   - the user is premium
 *   - it's the player's turn AND there are suggestions
 *
 * Visual: pill-shaped buttons at the bottom-center of the viewport, one
 * per available suggestion (up to 3). Each shows the slot color, the
 * configured hotkey label, and the move SAN — so the mapping between
 * button and keyboard shortcut stays explicit.
 *
 * Premove invocation (gives mobile / touch parity with the keyboard
 * modifier flow):
 *   - Desktop: hold the configured modifier (Shift by default) while
 *     clicking — same as on the keyboard path.
 *   - Touch / any device: long-press (≥ LONG_PRESS_MS) the button —
 *     after the threshold the button "arms" with a brighter state and
 *     `+pre` indicator; releasing fires play + premove. Releasing
 *     before the threshold fires play only.
 */

import { useEffect, useRef, useState } from 'react';
import { useAutoMoveStore } from '../stores/autoMoveStore';
import { useSuggestionStore } from '../stores/suggestionStore';
import { useGameStore } from '../stores/gameStore';
import { useAuthStore } from '../stores/authStore';
import { usePlatformStore, platformSupportsPremove } from '../stores/platformStore';
import { triggerHotkeyMove } from '../lib/autoMoveScheduler';
import { isPremiumPlan } from '../lib/premium';

const SLOT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b'];
const SLOT_BORDERS = [
  'rgba(34, 197, 94, 0.55)',
  'rgba(59, 130, 246, 0.55)',
  'rgba(245, 158, 11, 0.55)',
];
// Dark base + thin colored wash on top — keeps the move label legible
// on bright pages (chess.com light theme, white piece areas, etc.) while
// still hinting at the slot via a subtle tint. The chip + border stay
// the dominant slot identifiers.
const SLOT_BG = [
  'linear-gradient(rgba(34, 197, 94, 0.10), rgba(34, 197, 94, 0.10)), rgba(12, 14, 22, 0.92)',
  'linear-gradient(rgba(59, 130, 246, 0.10), rgba(59, 130, 246, 0.10)), rgba(12, 14, 22, 0.92)',
  'linear-gradient(rgba(245, 158, 11, 0.10), rgba(245, 158, 11, 0.10)), rgba(12, 14, 22, 0.92)',
];

/** Press-and-hold duration that arms the premove on touch / mouse. */
const LONG_PRESS_MS = 400;

function premoveKeyHeld(key: string, ev: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
  switch (key.toLowerCase()) {
    case 'shift':   return ev.shiftKey;
    case 'control':
    case 'ctrl':    return ev.ctrlKey;
    case 'alt':     return ev.altKey;
    case 'meta':
    case 'cmd':     return ev.metaKey;
    default:        return false;
  }
}

export default function HotkeyMoveButtons() {
  const mode               = useAutoMoveStore((s) => s.mode);
  const useOnScreenButtons = useAutoMoveStore((s) => s.useOnScreenButtons);
  const hotkey1            = useAutoMoveStore((s) => s.hotkey1);
  const hotkey2            = useAutoMoveStore((s) => s.hotkey2);
  const hotkey3            = useAutoMoveStore((s) => s.hotkey3);
  const premoveKey         = useAutoMoveStore((s) => s.premoveKey);

  const suggestions = useSuggestionStore((s) => s.suggestions);
  const isPlaying   = useGameStore((s) => s.isPlaying);
  const gameOver    = useGameStore((s) => s.gameOver);
  const turn        = useGameStore((s) => s.turn);
  const playerColor = useGameStore((s) => s.playerColor);

  const plan = useAuthStore((s) => s.plan);
  const platform = usePlatformStore((s) => s.platform);
  const premoveOk = platformSupportsPremove(platform);

  // Track whether the premove modifier is held on desktop — gives the
  // button a visual hint that clicking will also queue the premove.
  const [modHeld, setModHeld] = useState(false);
  // Long-press tracking. When the user holds a button past the threshold,
  // we mark that slot as "armed" — the visual updates and the eventual
  // pointerup fires with premove.
  // `armedSlot` is React state for the visual; `armedRef` mirrors it so
  // the pointerup handler can read the latest value without waiting for
  // a re-render commit (the user can release ~16ms after the threshold,
  // before React's next paint).
  const [armedSlot, setArmedSlot] = useState<number | null>(null);
  const armedRef = useRef<number | null>(null);
  const armTimerRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip the modifier listener entirely when premove isn't supported
    // — no point reading a key that won't trigger anything.
    if (!useOnScreenButtons || mode !== 'hotkey' || !premoveOk) return;
    const update = (e: KeyboardEvent) => {
      setModHeld(premoveKeyHeld(premoveKey, e));
    };
    const reset = () => setModHeld(false);
    window.addEventListener('keydown', update, true);
    window.addEventListener('keyup', update, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', update, true);
      window.removeEventListener('keyup', update, true);
      window.removeEventListener('blur', reset);
    };
  }, [useOnScreenButtons, mode, premoveKey, premoveOk]);

  // Render-gate. Cheap checks first.
  if (mode !== 'hotkey' || !useOnScreenButtons) return null;
  if (!isPremiumPlan(plan)) return null;
  if (!isPlaying || gameOver) return null;
  if (!playerColor || playerColor !== turn) return null;
  if (suggestions.length === 0) return null;

  const visible = suggestions.slice(0, 3);
  const hotkeys = [hotkey1, hotkey2, hotkey3];

  const cancelArm = () => {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    armedRef.current = null;
    setArmedSlot(null);
  };

  const startArm = (slot: number) => {
    cancelArm();
    // Skip arming entirely on platforms where premove isn't supported —
    // long-press on lichess / worldchess shouldn't pretend to queue a
    // premove that won't fire.
    if (!premoveOk) return;
    armTimerRef.current = window.setTimeout(() => {
      armedRef.current = slot;
      setArmedSlot(slot);
      armTimerRef.current = null;
    }, LONG_PRESS_MS);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 8,
        zIndex: 2147483645,                    // below FAB (…646), above page chrome
        pointerEvents: 'none',                 // wrapper passes through; only buttons receive clicks
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      {visible.map((sug, i) => {
        const color   = SLOT_COLORS[i];
        const border  = SLOT_BORDERS[i];
        const bg      = SLOT_BG[i];
        // Suggestion.move is UCI ("e2e4"). The panel's SuggestionRow shows
        // it raw — keep parity here so the button matches the user's
        // mental model from the row.
        const label   = sug.move;
        const hotkey  = hotkeys[i];
        const armed   = armedSlot === i;
        const showPre = armed || modHeld;

        return (
          <button
            key={`${sug.move}-${i}`}
            type="button"
            // We fire on pointerup so we can distinguish quick tap (no
            // premove) from long-press (premove). onClick still fires
            // as a side effect of the same gesture but we no-op it to
            // avoid double-trigger — the actual fire lives in onPointerUp.
            onClick={(e) => { e.preventDefault(); }}
            onPointerDown={(e) => {
              // setPointerCapture keeps events on this button if the user
              // drags the finger slightly while holding — common on touch.
              try { (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId); } catch {}
              startArm(i);
            }}
            onPointerUp={(e) => {
              const wasArmed = armedRef.current === i;
              const modifierActive = premoveKeyHeld(premoveKey, e);
              cancelArm();
              triggerHotkeyMove(i as 0 | 1 | 2, wasArmed || modifierActive);
            }}
            onPointerCancel={cancelArm}
            onPointerLeave={() => {
              // Drag-away cancels the long-press intent (user can release
              // off-button to abort). We don't reset on simple mousemove
              // inside the button — only when the pointer actually leaves.
              cancelArm();
            }}
            title={
              showPre
                ? `Play ${label} + queue premove (hotkey: ${hotkey})`
                : premoveOk
                  ? `Play ${label} (hotkey: ${hotkey} · long-press for premove)`
                  : `Play ${label} (hotkey: ${hotkey})`
            }
            style={{
              pointerEvents: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              minWidth: 64,
              borderRadius: 999,
              border: `1px solid ${armed ? color : border}`,
              background: bg,
              color: '#f8fafc',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
              boxShadow: armed
                ? `0 6px 20px rgba(0,0,0,0.4), 0 0 0 2px ${color}55, 0 1px 0 rgba(255,255,255,0.04) inset`
                : '0 6px 18px rgba(0, 0, 0, 0.35), 0 1px 0 rgba(255,255,255,0.04) inset',
              transition: 'transform 120ms ease, background 120ms ease, box-shadow 200ms ease, border-color 200ms ease',
              transform: armed ? 'translateY(-1px)' : 'translateY(0)',
              // No text selection on the move label / hotkey chip when
              // double-clicking. Also kills the iOS long-press callout +
              // tap-highlight on Android.
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
            }}
          >
            {/* Hotkey chip */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 22,
                height: 22,
                padding: '0 6px',
                borderRadius: 6,
                background: color,
                color: '#0a0a14',
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              {hotkey || '·'}
            </span>
            <span style={{ letterSpacing: '0.01em' }}>{label}</span>
            {showPre && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color,
                  opacity: 0.95,
                }}
              >
                +pre
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
