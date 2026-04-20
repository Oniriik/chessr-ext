/**
 * evalBar — Injects an eval bar directly in the page DOM next to the chess board.
 * Managed imperatively (no React) since it lives outside the Shadow DOM.
 */

import gsap from 'gsap';
import { useEvalStore } from '../stores/evalStore';
import { useGameStore } from '../stores/gameStore';
import { useSettingsStore } from '../stores/settingsStore';

const BAR_WIDTH = 22;
const BAR_ID = 'chessr-eval-bar';

let barEl: HTMLDivElement | null = null;
let fillEl: HTMLDivElement | null = null;
let textEl: HTMLSpanElement | null = null;
let resizeObserver: ResizeObserver | null = null;

function evalToPercent(evalPawns: number): number {
  const cp = evalPawns * 100;
  const pct = 50 + 50 * (2 / (1 + Math.exp(-0.004 * cp)) - 1);
  return Math.max(2, Math.min(98, pct));
}

function getBoard(): HTMLElement | null {
  return document.querySelector('wc-chess-board');
}

function createBar() {
  if (document.getElementById(BAR_ID)) {
    barEl = document.getElementById(BAR_ID) as HTMLDivElement;
    fillEl = barEl.querySelector('.chessr-eval-fill') as HTMLDivElement;
    textEl = barEl.querySelector('.chessr-eval-text') as HTMLSpanElement;
    return;
  }

  barEl = document.createElement('div');
  barEl.id = BAR_ID;
  Object.assign(barEl.style, {
    position: 'absolute',
    width: `${BAR_WIDTH}px`,
    display: 'none',
    flexDirection: 'column',
    justifyContent: 'flex-end',
    borderRadius: '4px',
    overflow: 'hidden',
    background: '#27272a',
    zIndex: '100',
    pointerEvents: 'none',
  });

  fillEl = document.createElement('div');
  fillEl.className = 'chessr-eval-fill';
  Object.assign(fillEl.style, {
    width: '100%',
    background: '#e4e4e7',
    borderRadius: '0 0 4px 4px',
    height: '50%',
  });

  textEl = document.createElement('span');
  textEl.className = 'chessr-eval-text';
  Object.assign(textEl.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    textAlign: 'center',
    fontSize: '8px',
    fontWeight: '700',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontVariantNumeric: 'tabular-nums',
    padding: '2px 0',
    pointerEvents: 'none',
  });

  barEl.appendChild(fillEl);
  barEl.appendChild(textEl);
  document.body.appendChild(barEl);
}

function positionBar() {
  const board = getBoard();
  if (!board || !barEl) return;

  const rect = board.getBoundingClientRect();
  Object.assign(barEl.style, {
    top: `${rect.top + window.scrollY}px`,
    left: `${rect.left - BAR_WIDTH - 4 + window.scrollX}px`,
    height: `${rect.height}px`,
    display: 'flex',
  });
}

function updateBar() {
  if (!fillEl || !textEl || !barEl) return;

  const evalPawns = useEvalStore.getState().eval;
  const mateIn = useEvalStore.getState().mateIn;
  const playerColor = useGameStore.getState().playerColor;
  const isPlaying = useGameStore.getState().isPlaying;
  const disableAnimations = useSettingsStore.getState().disableAnimations;

  if (!isPlaying || evalPawns === null) {
    barEl.style.display = 'none';
    return;
  }

  const isFlipped = playerColor === 'black';

  // Calculate fill percentage
  let fillPct = 50;
  if (mateIn !== null) {
    fillPct = mateIn > 0 ? 98 : 2;
  } else {
    fillPct = evalToPercent(evalPawns);
  }
  if (isFlipped) fillPct = 100 - fillPct;

  // Animate fill
  if (disableAnimations) {
    fillEl.style.height = `${fillPct}%`;
  } else {
    gsap.to(fillEl, { height: `${fillPct}%`, duration: 0.5, ease: 'power2.out' });
  }

  // Eval text
  let evalText = '';
  if (mateIn !== null) {
    evalText = `M${Math.abs(mateIn)}`;
  } else {
    const abs = Math.abs(evalPawns);
    evalText = abs < 0.05 ? '0.0' : abs.toFixed(1);
  }
  textEl.textContent = evalText;

  // Position text on winning side
  const whiteAdvantage = evalPawns > 0;
  const bottomWinning = isFlipped ? !whiteAdvantage : whiteAdvantage;

  if (bottomWinning) {
    textEl.style.top = '';
    textEl.style.bottom = '2px';
    textEl.style.color = '#27272a';
  } else {
    textEl.style.bottom = '';
    textEl.style.top = '2px';
    textEl.style.color = '#e4e4e7';
  }

  positionBar();
  barEl.style.display = 'flex';
}

export function initEvalBar() {
  createBar();
  positionBar();

  // Watch board resize
  const board = getBoard();
  if (board) {
    resizeObserver = new ResizeObserver(positionBar);
    resizeObserver.observe(board);
  }

  window.addEventListener('scroll', positionBar);
  window.addEventListener('resize', positionBar);

  // Subscribe to eval changes only — gameStore only for show/hide + positioning
  useEvalStore.subscribe(updateBar);
  useGameStore.subscribe((state, prev) => {
    // Only react to isPlaying or playerColor changes, not every move
    if (state.isPlaying !== prev.isPlaying || state.playerColor !== prev.playerColor) {
      updateBar();
    }
  });

  // Also watch for board appearing later
  const observer = new MutationObserver(() => {
    const b = getBoard();
    if (b && !resizeObserver) {
      resizeObserver = new ResizeObserver(positionBar);
      resizeObserver.observe(b);
      positionBar();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function destroyEvalBar() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('scroll', positionBar);
  window.removeEventListener('resize', positionBar);
  barEl?.remove();
  barEl = null;
  fillEl = null;
  textEl = null;
}
