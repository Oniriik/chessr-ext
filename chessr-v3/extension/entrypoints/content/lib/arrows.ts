import gsap from 'gsap';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameStore } from '../stores/gameStore';
import type { LabeledSuggestion } from './engineLabeler';

const DRAW_DURATION = 0.3;

let overlay: SVGSVGElement | null = null;
let arrowGroup: SVGGElement | null = null;
let defs: SVGDefsElement | null = null;
let squareSize = 0;
let flipped = false;
let resizeObserver: ResizeObserver | null = null;
let lastSuggestions: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore'>[] = [];

function getBoard(): HTMLElement | null {
  return document.querySelector('wc-chess-board') as HTMLElement | null;
}

function getSquareCenter(square: string): { x: number; y: number } | null {
  if (square.length < 2) return null;
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]) - 1;
  const x = (flipped ? 7 - file : file) * squareSize + squareSize / 2;
  const y = (flipped ? rank : 7 - rank) * squareSize + squareSize / 2;
  return { x, y };
}

function createOverlay(board: HTMLElement) {
  overlay?.remove();
  const rect = board.getBoundingClientRect();
  squareSize = rect.width / 8;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chessr-arrow-overlay');
  svg.setAttribute('width', `${rect.width}`);
  svg.setAttribute('height', `${rect.width}`);
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.width}`);
  svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:100;';

  const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(d);
  defs = d;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(g);
  arrowGroup = g;

  const pos = getComputedStyle(board).position;
  if (pos === 'static') board.style.position = 'relative';

  board.appendChild(svg);
  overlay = svg;
}

function ensureMarker(color: string, index: number) {
  if (!defs) return;
  const id = `chessr-marker-${index}`;
  if (defs.querySelector(`#${id}`)) return;

  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', id);
  marker.setAttribute('markerWidth', '2.5');
  marker.setAttribute('markerHeight', '2.5');
  marker.setAttribute('refX', '0.5');
  marker.setAttribute('refY', '1.25');
  marker.setAttribute('orient', 'auto');
  marker.setAttribute('markerUnits', 'strokeWidth');
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', '0 0, 2.5 1.25, 0 2.5');
  polygon.setAttribute('fill', color);
  marker.appendChild(polygon);
  defs.appendChild(marker);
}

const LABEL_COLORS: Record<string, string> = {
  check: '#fb923c',
  mate: '#c084fc',
  capture: '#94a3b8',
};

const PROMO_SYMBOLS: Record<string, string> = {
  q: 'Q', r: 'R', b: 'B', n: 'N',
};

function resolveLabelDisplay(label: string, mateScore?: number | null): { displayLabel: string; displayText: string; badgeColor: string } {
  if (label.startsWith('promotion:')) {
    const piece = label.split(':')[1];
    return { displayLabel: 'promotion', displayText: `Promo ${PROMO_SYMBOLS[piece] || '♛'}`, badgeColor: '#c084fc' };
  }
  if (label === 'mate' && mateScore != null) {
    return { displayLabel: label, displayText: Math.abs(mateScore) === 1 ? 'Mate' : `M${Math.abs(mateScore)}`, badgeColor: LABEL_COLORS[label] || '#c084fc' };
  }
  return { displayLabel: label, displayText: label.charAt(0).toUpperCase() + label.slice(1), badgeColor: LABEL_COLORS[label] || '#94a3b8' };
}

function drawBadge(pt: { x: number; y: number }, label: string, badgeColor: string, animate = true, displayText?: string, stackIndex = 0) {
  if (!arrowGroup) return;

  const text = (displayText || label.charAt(0).toUpperCase() + label.slice(1)).toUpperCase();
  const fontSize = Math.max(6, squareSize / 11);
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.2;
  const badgeW = text.length * fontSize * 0.65 + padX * 2;
  const badgeH = fontSize + padY * 2;

  // Top-right corner of the square, inset from edges, stacked vertically
  const inset = 8;
  const x = pt.x + squareSize / 2 - badgeW / 2 - inset;
  const y = pt.y - squareSize / 2 + badgeH / 2 + inset + stackIndex * (badgeH + 2);

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('transform', `translate(${x}, ${y})`);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', `${-badgeW / 2}`);
  rect.setAttribute('y', `${-badgeH / 2}`);
  rect.setAttribute('width', `${badgeW}`);
  rect.setAttribute('height', `${badgeH}`);
  rect.setAttribute('rx', `${fontSize * 0.3}`);
  const r = parseInt(badgeColor.slice(1, 3), 16);
  const g2 = parseInt(badgeColor.slice(3, 5), 16);
  const b = parseInt(badgeColor.slice(5, 7), 16);
  rect.setAttribute('fill', `rgba(${r}, ${g2}, ${b}, 0.8)`);
  g.appendChild(rect);

  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', '0');
  txt.setAttribute('y', `${fontSize * 0.35}`);
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('font-size', `${fontSize}`);
  txt.setAttribute('font-weight', '700');
  txt.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, sans-serif');
  txt.setAttribute('letter-spacing', '0.04em');
  txt.setAttribute('fill', 'white');
  txt.textContent = text;
  g.appendChild(txt);

  arrowGroup.appendChild(g);

  if (animate) {
    gsap.fromTo(g,
      { attr: { transform: `translate(${x}, ${y}) scale(0)` }, opacity: 0 },
      { attr: { transform: `translate(${x}, ${y}) scale(1)` }, opacity: 1, duration: 0.2, ease: 'back.out(2)' },
    );
  }
}

function drawArrow(from: string, to: string, index: number, animate = true, labels?: string[], mateScore?: number | null): SVGPathElement | null {
  if (!arrowGroup) return null;

  const fromPt = getSquareCenter(from);
  const toPt = getSquareCenter(to);
  if (!fromPt || !toPt) return null;

  const { arrowColors } = useSettingsStore.getState();
  const color = arrowColors[index] || arrowColors[2];
  const thickness = Math.max(5, Math.round(squareSize / 10));
  const shortenBy = thickness * 2;

  ensureMarker(color, index);

  // Highlight destination square with inset padding
  if (useSettingsStore.getState().highlightSquares) {
    const pad = 4;
    const hlRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hlRect.setAttribute('x', `${toPt.x - squareSize / 2 + pad}`);
    hlRect.setAttribute('y', `${toPt.y - squareSize / 2 + pad}`);
    hlRect.setAttribute('width', `${squareSize - pad * 2}`);
    hlRect.setAttribute('height', `${squareSize - pad * 2}`);
    hlRect.setAttribute('rx', '4');
    hlRect.setAttribute('fill', color);
    hlRect.setAttribute('opacity', '0.15');
    arrowGroup.appendChild(hlRect);
  }

  const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const rankDiff = Math.abs(parseInt(from[1]) - parseInt(to[1]));
  const isKnight = (fileDiff === 1 && rankDiff === 2) || (fileDiff === 2 && rankDiff === 1);

  let d: string;

  if (isKnight) {
    const ddx = toPt.x - fromPt.x;
    const ddy = toPt.y - fromPt.y;
    const cornerX = Math.abs(ddx) > Math.abs(ddy) ? toPt.x : fromPt.x;
    const cornerY = Math.abs(ddx) > Math.abs(ddy) ? fromPt.y : toPt.y;

    const edx = toPt.x - cornerX;
    const edy = toPt.y - cornerY;
    const elen = Math.sqrt(edx * edx + edy * edy);
    const ratio = elen > 0 ? (elen - shortenBy) / elen : 1;
    const endX = cornerX + edx * ratio;
    const endY = cornerY + edy * ratio;

    d = `M ${fromPt.x} ${fromPt.y} L ${cornerX} ${cornerY} L ${endX} ${endY}`;
  } else {
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ratio = (len - shortenBy) / len;
    const endX = fromPt.x + dx * ratio;
    const endY = fromPt.y + dy * ratio;

    d = `M ${fromPt.x} ${fromPt.y} L ${endX} ${endY}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', `${thickness}`);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.85');
  arrowGroup.appendChild(path);

  if (animate) {
    const totalLength = path.getTotalLength();
    path.setAttribute('stroke-dasharray', `${totalLength}`);
    path.setAttribute('stroke-dashoffset', `${totalLength}`);

    gsap.to(path, {
      strokeDashoffset: 0,
      duration: DRAW_DURATION,
      ease: 'power2.out',
      onComplete: () => {
        path.setAttribute('marker-end', `url(#chessr-marker-${index})`);
        if (labels?.length) {
          labels.forEach((l, i) => {
            const { displayLabel, displayText, badgeColor } = resolveLabelDisplay(l, mateScore);
            drawBadge(toPt, displayLabel, badgeColor, true, displayText, i);
          });
        }
      },
    });
  } else {
    path.setAttribute('marker-end', `url(#chessr-marker-${index})`);
    if (labels?.length) {
      labels.forEach((l, i) => {
        const { displayLabel, displayText, badgeColor } = resolveLabelDisplay(l, mateScore);
        drawBadge(toPt, displayLabel, badgeColor, false, displayText, i);
      });
    }
  }

  return path;
}

export function renderArrows(suggestions: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore'>[], isFlipped: boolean, animate = true) {
  const board = getBoard();
  if (!board) return;

  if (useSettingsStore.getState().disableAnimations) animate = false;

  flipped = isFlipped;

  const rect = board.getBoundingClientRect();
  if (!overlay || Math.abs(rect.width / 8 - squareSize) > 1) {
    createOverlay(board);
  }

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (overlay && lastSuggestions.length) {
        createOverlay(board);
        if (arrowGroup) arrowGroup.innerHTML = '';
        if (defs) defs.innerHTML = '';
        for (const s of lastSuggestions) {
          drawArrow(s.move.slice(0, 2), s.move.slice(2, 4), lastSuggestions.indexOf(s), false, s.labels, s.mateScore);
        }
      }
    });
    resizeObserver.observe(board);
  }

  lastSuggestions = suggestions;

  // Kill any in-progress clear animation before drawing
  if (arrowGroup) {
    gsap.killTweensOf(arrowGroup.children);
    arrowGroup.innerHTML = '';
  }
  if (defs) defs.innerHTML = '';

  const sorted = [...suggestions].map((s, i) => ({ ...s, index: i }));
  sorted.sort((a, b) => {
    const lenA = Math.abs(a.move.charCodeAt(0) - a.move.charCodeAt(2)) + Math.abs(parseInt(a.move[1]) - parseInt(a.move[3]));
    const lenB = Math.abs(b.move.charCodeAt(0) - b.move.charCodeAt(2)) + Math.abs(parseInt(b.move[1]) - parseInt(b.move[3]));
    return lenB - lenA;
  });

  for (const s of sorted) {
    drawArrow(s.move.slice(0, 2), s.move.slice(2, 4), s.index, animate, s.labels, s.mateScore);
  }
}

export function clearArrows() {
  lastSuggestions = [];
  if (!arrowGroup) return;
  const children = Array.from(arrowGroup.children);
  if (!children.length) return;

  if (useSettingsStore.getState().disableAnimations) {
    arrowGroup.innerHTML = '';
    if (defs) defs.innerHTML = '';
    return;
  }

  gsap.to(children, {
    opacity: 0,
    duration: 0.15,
    ease: 'power2.in',
    onComplete: () => {
      if (arrowGroup) arrowGroup.innerHTML = '';
      if (defs) defs.innerHTML = '';
    },
  });
}

/**
 * Render PV continuation arrows on the board.
 * Alternates white/black arrows with decreasing opacity.
 * Clears existing suggestion arrows first.
 */
export function renderPvArrows(pv: string[], isFlipped: boolean, playerIsWhite: boolean) {
  const board = getBoard();
  if (!board || pv.length < 1) return;

  flipped = isFlipped;

  const rect = board.getBoundingClientRect();
  if (!overlay || Math.abs(rect.width / 8 - squareSize) > 1) {
    createOverlay(board);
  }

  if (arrowGroup) {
    gsap.killTweensOf(arrowGroup.children);
    arrowGroup.innerHTML = '';
  }
  if (defs) defs.innerHTML = '';

  // First move in PV is the suggestion (player's move), pv[1] is opponent, etc.
  const isPlayerFirst = true; // pv[0] is always the player's suggested move

  pv.forEach((move, i) => {
    if (move.length < 4) return;
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const fromPt = getSquareCenter(from);
    const toPt = getSquareCenter(to);
    if (!fromPt || !toPt) return;

    // Alternate: even index = player, odd = opponent
    const isPlayerMove = i % 2 === 0;
    const isWhiteMove = isPlayerFirst ? (isPlayerMove === playerIsWhite) : (isPlayerMove !== playerIsWhite);
    const arrowColor = isWhiteMove ? '#ffffff' : '#1a1a2e';
    const strokeColor = isWhiteMove ? '#ffffff' : '#27272a';
    const opacity = Math.max(0.2, 1 - i * 0.15);

    const thickness = Math.max(4, Math.round(squareSize / 12));
    const shortenBy = thickness * 2;

    // Ensure marker
    const markerId = `chessr-pv-marker-${i}`;
    if (defs && !defs.querySelector(`#${markerId}`)) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('markerWidth', '2.5');
      marker.setAttribute('markerHeight', '2.5');
      marker.setAttribute('refX', '0.5');
      marker.setAttribute('refY', '1.25');
      marker.setAttribute('orient', 'auto');
      marker.setAttribute('markerUnits', 'strokeWidth');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', '0 0, 2.5 1.25, 0 2.5');
      polygon.setAttribute('fill', strokeColor);
      marker.appendChild(polygon);
      defs.appendChild(marker);
    }

    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ratio = (len - shortenBy) / len;
    const endX = fromPt.x + dx * ratio;
    const endY = fromPt.y + dy * ratio;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${fromPt.x} ${fromPt.y} L ${endX} ${endY}`);
    path.setAttribute('stroke', strokeColor);
    path.setAttribute('stroke-width', `${thickness}`);
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', `${opacity}`);
    path.setAttribute('marker-end', `url(#${markerId})`);
    arrowGroup!.appendChild(path);

    // Move number circle on the start square
    const numSize = Math.max(10, squareSize / 5);
    const cx = fromPt.x - squareSize / 2 + numSize / 2 + 4;
    const cy = fromPt.y - squareSize / 2 + numSize / 2 + 4;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', `${cx}`);
    circle.setAttribute('cy', `${cy}`);
    circle.setAttribute('r', `${numSize / 2}`);
    circle.setAttribute('fill', strokeColor);
    circle.setAttribute('opacity', `${opacity}`);
    arrowGroup!.appendChild(circle);

    const num = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    num.setAttribute('x', `${cx}`);
    num.setAttribute('y', `${cy + numSize * 0.17}`);
    num.setAttribute('text-anchor', 'middle');
    num.setAttribute('font-size', `${numSize * 0.55}`);
    num.setAttribute('font-weight', '700');
    num.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, sans-serif');
    num.setAttribute('fill', isWhiteMove ? '#1a1a2e' : '#ffffff');
    num.setAttribute('opacity', `${opacity}`);
    num.textContent = `${i + 1}`;
    arrowGroup!.appendChild(num);
  });
}

export function restoreSuggestionArrows() {
  if (lastSuggestions.length) {
    const isFlipped = useGameStore.getState().playerColor === 'black';
    renderArrows(lastSuggestions, isFlipped, false);
  }
}

export function destroyOverlay() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  overlay?.remove();
  overlay = null;
  arrowGroup = null;
  defs = null;
}
