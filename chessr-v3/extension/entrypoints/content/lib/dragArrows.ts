/**
 * dragArrows — shrink suggestion arrows in real time as the user drags the
 * matching piece toward the destination square.
 *
 * Flow:
 *   pointerdown on the chess.com board
 *     └─ if the pointer is on a square with a suggestion arrow → start tracking
 *   pointermove while tracking
 *     └─ update each matching arrow's length so its "tail" follows the cursor
 *   pointerup / pointercancel / pointerleave / blur
 *     └─ reset all arrows for that square back to their full length
 */

import {
  hasArrowFrom,
  updateArrowsForDrag,
  resetArrowDragProgress,
  cursorToSquare,
  cursorToOverlayCoords,
} from './arrows';

let installed = false;
let draggedFrom: string | null = null;

function onPointerDown(e: PointerEvent) {
  // Only react to primary button (left click / single-finger touch).
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  const square = cursorToSquare(e.clientX, e.clientY);
  if (!square || !hasArrowFrom(square)) return;

  draggedFrom = square;
}

function onPointerMove(e: PointerEvent) {
  if (!draggedFrom) return;
  const coords = cursorToOverlayCoords(e.clientX, e.clientY);
  if (!coords) return;
  updateArrowsForDrag(draggedFrom, coords.x, coords.y);
}

function endDrag() {
  if (!draggedFrom) return;
  resetArrowDragProgress(draggedFrom);
  draggedFrom = null;
}

/**
 * Attach pointer listeners to the document (so we can see drags even when
 * chess.com's board element swallows or re-parents events). Idempotent.
 */
export function installArrowDrag(): void {
  if (installed) return;
  installed = true;
  // Capture phase so we see the events before chess.com's own handlers can
  // stop propagation inside the board.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);
  window.addEventListener('blur', endDrag);
}

export function uninstallArrowDrag(): void {
  if (!installed) return;
  installed = false;
  document.removeEventListener('pointerdown', onPointerDown, true);
  document.removeEventListener('pointermove', onPointerMove, true);
  document.removeEventListener('pointerup', endDrag, true);
  document.removeEventListener('pointercancel', endDrag, true);
  window.removeEventListener('blur', endDrag);
  endDrag();
}
