import gsap from 'gsap';
import { useSettingsStore } from '../stores/settingsStore';
import { useGameStore } from '../stores/gameStore';
import { boardSelectors } from '../adapters/BoardSelectors';
import { isStreamOpen, streamOpenReady } from './streamOpen';
import type { LabeledSuggestion } from './engineLabeler';
import type { MoveClassification } from './moveAnalysis';

// Mirrors PerformanceCard / SuggestionRow palette — keep in sync.
const CLASSIFICATION_COLOR: Record<MoveClassification, string> = {
  best:       '#81B64C',
  brilliant:  '#26C2A3',
  great:      '#749BBF',
  excellent:  '#6ee7b7',
  good:       '#95B776',
  book:       '#D5A47D',
  forced:     '#96AF8B',
  inaccuracy: '#F7C631',
  mistake:    '#FFA459',
  miss:       '#FF7769',
  blunder:    '#FA412D',
};
const CLASSIFICATION_LABEL: Record<MoveClassification, string> = {
  best: 'Best', brilliant: 'Brill', great: 'Great', excellent: 'Excel',
  good: 'Good', book: 'Book', forced: 'Frcd',
  inaccuracy: 'Inacc', mistake: 'Mist', miss: 'Miss', blunder: 'Blund',
};

const DRAW_DURATION = 0.3;

let overlay: SVGSVGElement | null = null;
let arrowGroup: SVGGElement | null = null;
let defs: SVGDefsElement | null = null;
let squareSize = 0;
let flipped = false;
let resizeObserver: ResizeObserver | null = null;
let lastSuggestions: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore' | 'class'>[] = [];
let lastOpponentMove: { uci: string; classification?: MoveClassification } | null = null;
let opponentMoveGroup: SVGGElement | null = null;
let lastMyMove: { uci: string; classification?: MoveClassification } | null = null;
let myLastMoveGroup: SVGGElement | null = null;
let lastTheoryMove: string | null = null;
let lastTheoryColor: string = '#D5A47D';
let lastTheoryLabel: string | undefined = undefined;
let theoryArrowGroup: SVGGElement | null = null;
let lastDeviationMove: string | null = null;
let lastDeviationColor: string = '#fde047';
let lastDeviationLabel: string | undefined = undefined;
let deviationArrowGroup: SVGGElement | null = null;
let lastPremoveMove: string | null = null;
let premoveArrowGroup: SVGGElement | null = null;

// Drawn-arrow registry keyed by `from` square so drag handlers can shorten
// or hide the matching arrows in real time as the user drags the piece.
interface DrawnArrow {
  path: SVGPathElement;
  fromPt: { x: number; y: number };
  toPt: { x: number; y: number };   // the shortened tip (where the arrow head sits)
  corner?: { x: number; y: number }; // only set for knight L-paths
  segA?: number;                     // length of the first (fromPt→corner) segment
  segB?: number;                     // length of the second (corner→toPt) segment
  totalLen: number;
}
const arrowsByFrom = new Map<string, DrawnArrow[]>();

// Per-suggestion badge container (classification + standard labels for
// one arrow), keyed by the full UCI move so two suggestions sharing a
// `from` square (e.g. two different promotion pieces) get distinct
// badge groups. Tracked separately from arrows so renderBadges() can
// swap badges in place without re-rendering the arrow path — torch's
// async classifyCandidate landing should not re-animate the arrow.
const badgeGroupByMove = new Map<string, SVGGElement>();

function getBoard(): HTMLElement | null {
  return boardSelectors.boardEl();
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

/** Build a single badge <g> at slot `stackIndex` (0 = top, others stacked
 *  below). Used for both classification badges and standard labels. */
function makeBadge(toPt: { x: number; y: number }, text: string, badgeColor: string, stackIndex: number, animate: boolean): SVGGElement {
  const fontSize = Math.max(6, squareSize / 11);
  const padX = fontSize * 0.6;
  const padY = fontSize * 0.2;
  const badgeW = text.length * fontSize * 0.65 + padX * 2;
  const badgeH = fontSize + padY * 2;
  const inset = 8;
  const x = toPt.x + squareSize / 2 - badgeW / 2 - inset;
  const y = toPt.y - squareSize / 2 + badgeH / 2 + inset + stackIndex * (badgeH + 2);

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
  rect.setAttribute('fill', `rgba(${r}, ${g2}, ${b}, 0.85)`);
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
  txt.textContent = text.toUpperCase();
  g.appendChild(txt);

  if (animate) {
    gsap.fromTo(g,
      { attr: { transform: `translate(${x}, ${y}) scale(0)` }, opacity: 0 },
      { attr: { transform: `translate(${x}, ${y}) scale(1)` }, opacity: 1, duration: 0.2, ease: 'back.out(2)' },
    );
  }
  return g;
}

/** Number of badge slots already occupied on `square` by OTHER arrow
 *  groups (suggestion stacks + persistent arrows). Badges from independent
 *  sources (suggestion, opponent move, my last move, book, premove) can
 *  target the same destination square — e.g. a recapture — and each source
 *  stacks its own badges from 0, so without this offset they'd overlap. */
function occupiedBadgeSlots(square: string, exclude?: SVGGElement | null): number {
  let n = 0;
  for (const [move, g] of badgeGroupByMove) {
    if (g !== exclude && g.isConnected && move.slice(2, 4) === square) n += g.childElementCount;
  }
  const persistent: Array<[SVGGElement | null, string | null]> = [
    [opponentMoveGroup, lastOpponentMove?.uci ?? null],
    [myLastMoveGroup, lastMyMove?.uci ?? null],
    [theoryArrowGroup, lastTheoryMove],
    [deviationArrowGroup, lastDeviationMove],
    [premoveArrowGroup, lastPremoveMove],
  ];
  for (const [g, uci] of persistent) {
    if (g && g !== exclude && g.isConnected && uci && uci.slice(2, 4) === square) {
      // Persistent groups hold the arrow <path> plus badge <g> children.
      n += Array.from(g.children).filter((c) => c.tagName.toLowerCase() === 'g').length;
    }
  }
  return n;
}

/** Draw all badges (classification + standard labels) for one suggestion.
 *  Classification ALWAYS sits at slot 0 (per UI convention — see
 *  SuggestionRow); standard labels stack below it. Returns the wrapping
 *  <g> so the caller can track + atomically replace it on updates. */
function buildSuggestionBadges(s: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore' | 'class'>, animate: boolean): SVGGElement | null {
  const to = s.move.slice(2, 4);
  const toPt = getSquareCenter(to);
  if (!toPt) return null;

  const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  wrapper.setAttribute('data-badges-for', s.move);
  // Start below any badges other sources already placed on this square
  // (persistent arrows targeting the same destination).
  let slot = occupiedBadgeSlots(to);
  // Opening theory label always tops the stack when this suggestion IS the
  // theory move — the theory arrow itself is not drawn in that case (the
  // suggestion arrow already shows the move), only its label survives here.
  if (lastTheoryLabel && lastTheoryMove === s.move) {
    wrapper.appendChild(makeBadge(toPt, lastTheoryLabel.slice(0, 5), lastTheoryColor, slot++, animate));
  }
  // Same merge rule for the deviation (book-reply) arrow label.
  if (lastDeviationLabel && lastDeviationMove === s.move) {
    wrapper.appendChild(makeBadge(toPt, lastDeviationLabel.slice(0, 5), lastDeviationColor, slot++, animate));
  }
  if (s.class) {
    const cls = s.class;
    wrapper.appendChild(makeBadge(toPt, CLASSIFICATION_LABEL[cls], CLASSIFICATION_COLOR[cls], slot++, animate));
  }
  for (const l of s.labels ?? []) {
    const { displayText, badgeColor } = resolveLabelDisplay(l, s.mateScore);
    wrapper.appendChild(makeBadge(toPt, displayText, badgeColor, slot++, animate));
  }
  return wrapper;
}

/** Render badges (classification + labels) for the current suggestion
 *  set. Idempotent: drops a move's badge group when its `move` is gone,
 *  rebuilds in place when its labels/class changed, leaves others alone.
 *  Called from renderArrows after the paths land, AND from
 *  applyClassificationsToBoard when async torch results stream in.
 *
 *  Promotion-label dedup: when several suggestions promote to the same
 *  destination square (engine returned Q/R/B/N alternatives in MultiPV),
 *  only the FIRST candidate (the top-rated suggestion in the iteration
 *  order) keeps its `promotion:*` label. The cheaper alternatives lose
 *  it — same square, same redundant "Promo X" badge would otherwise
 *  stack visually on the destination corner. Other label types
 *  (check/capture/mate) still propagate to all matching arrows. */
function renderBadges(suggestions: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore' | 'class'>[], animate: boolean) {
  if (!arrowGroup) return;
  const moveSet = new Set(suggestions.map((s) => s.move));
  // Drop badge groups whose move dropped out of the suggestion list
  for (const [m, g] of badgeGroupByMove) {
    if (!moveSet.has(m)) {
      g.remove();
      badgeGroupByMove.delete(m);
    }
  }
  const promoSeenAtSquare = new Set<string>();
  for (const s of suggestions) {
    const to = s.move.slice(2, 4);
    const isPromo = (s.labels ?? []).some((l) => l.startsWith('promotion:'));
    let effectiveLabels = s.labels ?? [];
    if (isPromo) {
      if (promoSeenAtSquare.has(to)) {
        // Drop the promo label — already shown by an earlier (better) candidate.
        effectiveLabels = effectiveLabels.filter((l) => !l.startsWith('promotion:'));
      } else {
        promoSeenAtSquare.add(to);
      }
    }
    const theoryKey = lastTheoryLabel && lastTheoryMove === s.move
      ? `${lastTheoryLabel.slice(0, 5)}@${lastTheoryColor}` : '-';
    const devKey = lastDeviationLabel && lastDeviationMove === s.move
      ? `${lastDeviationLabel.slice(0, 5)}@${lastDeviationColor}` : '-';
    const stateKey = `${theoryKey}|${devKey}|${s.class ?? '-'}|${effectiveLabels.join(',')}|${s.mateScore ?? '-'}`;
    const existing = badgeGroupByMove.get(s.move);
    if (existing && existing.getAttribute('data-state') === stateKey) continue;
    if (existing) {
      existing.remove();
      badgeGroupByMove.delete(s.move);
    }
    const wrapper = buildSuggestionBadges({ ...s, labels: effectiveLabels }, animate);
    if (!wrapper) continue;
    wrapper.setAttribute('data-state', stateKey);
    arrowGroup.appendChild(wrapper);
    badgeGroupByMove.set(s.move, wrapper);
  }
}

/** Public hook: torch's async classifyCandidate stream lands here. Just
 *  refresh badges — the underlying arrows stay put.
 *
 *  Gated on isStreamOpen: when Stream Mode is active the on-platform
 *  overlay is intentionally empty (the streamer's audience sees the
 *  board in the dedicated tab, not on chess.com). renderArrows has the
 *  same gate, but torch results arrive async and can land after stream
 *  opens — without this check they re-inject badges on the host board. */
export function applyClassificationsToBoard(suggestions: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore' | 'class'>[]) {
  if (!streamOpenReady() || isStreamOpen()) return;
  // Keep the snapshot in sync — theory/deviation arrow updates re-run
  // renderBadges(lastSuggestions) at any time, and a stale array here
  // would rebuild the badges WITHOUT the classifications torch just sent.
  lastSuggestions = suggestions;
  renderBadges(suggestions, true);
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
  let cornerPt: { x: number; y: number } | undefined;
  let segA: number | undefined;
  let segB: number | undefined;
  let totalLen: number;
  let shortenedTip: { x: number; y: number };

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
    cornerPt = { x: cornerX, y: cornerY };
    segA = Math.sqrt((cornerX - fromPt.x) ** 2 + (cornerY - fromPt.y) ** 2);
    segB = Math.sqrt((endX - cornerX) ** 2 + (endY - cornerY) ** 2);
    totalLen = segA + segB;
    shortenedTip = { x: endX, y: endY };
  } else {
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ratio = (len - shortenBy) / len;
    const endX = fromPt.x + dx * ratio;
    const endY = fromPt.y + dy * ratio;

    d = `M ${fromPt.x} ${fromPt.y} L ${endX} ${endY}`;
    totalLen = Math.sqrt((endX - fromPt.x) ** 2 + (endY - fromPt.y) ** 2);
    shortenedTip = { x: endX, y: endY };
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

  // Register for drag-progress updates
  const entry: DrawnArrow = {
    path, fromPt, toPt: shortenedTip, corner: cornerPt, segA, segB, totalLen,
  };
  const existing = arrowsByFrom.get(from);
  if (existing) existing.push(entry); else arrowsByFrom.set(from, [entry]);

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
      },
    });
  } else {
    path.setAttribute('marker-end', `url(#chessr-marker-${index})`);
  }
  // Badges (classification + standard labels) are drawn by renderBadges
  // — kept separate so async classifyCandidate updates can swap them
  // without re-animating the arrow path.

  return path;
}

export function renderArrows(suggestions: Pick<LabeledSuggestion, 'move' | 'labels' | 'mateScore'>[], isFlipped: boolean, animate = true) {
  // Block until we've confirmed stream state from storage — the async
  // read resolves in <10 ms, well before any suggestion can arrive.
  if (!streamOpenReady()) return;
  // Stream Mode hides the chessr UI from the host page so the streamer
  // can share their board without leaking moves on stream. The arrow
  // overlay sits on the host's chess board (not on our shadow root), so
  // it must be gated separately — the App-level CSS that hides the FAB
  // can't reach it.
  if (isStreamOpen()) {
    clearArrows();
    return;
  }

  const board = getBoard();
  if (!board) return;

  const _settings = useSettingsStore.getState();
  if (_settings.disableAnimations) animate = false;
  if (!_settings.showSuggestedMoves) {
    // Clear suggestion arrows but preserve the opponent move arrow.
    lastSuggestions = [];
    arrowsByFrom.clear();
    badgeGroupByMove.clear();
    if (arrowGroup) {
      Array.from(arrowGroup.children).forEach((c) => {
        if (c !== opponentMoveGroup) c.remove();
      });
    }
    return;
  }

  flipped = isFlipped;

  const rect = board.getBoundingClientRect();
  // Also recreate when the overlay was detached from the DOM — Lichess'
  // puzzle.jump() rebuilds chessground's children, which orphans our SVG.
  if (!overlay || !overlay.isConnected || overlay.parentElement !== board || Math.abs(rect.width / 8 - squareSize) > 1) {
    createOverlay(board);
  }

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      if (overlay && (lastSuggestions.length || lastOpponentMove)) {
        createOverlay(board);
        if (arrowGroup) arrowGroup.innerHTML = '';
        if (defs) defs.innerHTML = '';
        badgeGroupByMove.clear();
        opponentMoveGroup = null;
        theoryArrowGroup = null;
        deviationArrowGroup = null;
        premoveArrowGroup = null;
        if (lastOpponentMove) setOpponentMove(lastOpponentMove);
        if (lastMyMove) setMyLastMove(lastMyMove);
        for (const s of lastSuggestions) {
          drawArrow(s.move.slice(0, 2), s.move.slice(2, 4), lastSuggestions.indexOf(s), false, s.labels, s.mateScore);
        }
        renderBadges(lastSuggestions, false);
        if (lastTheoryMove) setTheoryArrow(lastTheoryMove, lastTheoryColor, lastTheoryLabel);
        if (lastDeviationMove) setDeviationArrow(lastDeviationMove, lastDeviationColor, lastDeviationLabel);
        if (lastPremoveMove) setPremoveArrow(lastPremoveMove);
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
  // innerHTML='' wiped both the suggestion groups AND the opponent/my-last-move
  // groups — reset stale refs so re-draws are clean.
  opponentMoveGroup = null;
  myLastMoveGroup = null;
  theoryArrowGroup = null;
  deviationArrowGroup = null;
  premoveArrowGroup = null;
  arrowsByFrom.clear();
  // arrowGroup.innerHTML='' wiped every <g> we tracked too — drop the
  // badge map so renderBadges re-creates fresh entries for the new
  // arrows instead of trying to reuse stale ones.
  badgeGroupByMove.clear();

  const sorted = [...suggestions].map((s, i) => ({ ...s, index: i }));
  sorted.sort((a, b) => {
    const lenA = Math.abs(a.move.charCodeAt(0) - a.move.charCodeAt(2)) + Math.abs(parseInt(a.move[1]) - parseInt(a.move[3]));
    const lenB = Math.abs(b.move.charCodeAt(0) - b.move.charCodeAt(2)) + Math.abs(parseInt(b.move[1]) - parseInt(b.move[3]));
    return lenB - lenA;
  });

  for (const s of sorted) {
    drawArrow(s.move.slice(0, 2), s.move.slice(2, 4), s.index, animate, s.labels, s.mateScore);
  }
  // Badges drawn immediately — they animate themselves with their own
  // back.out scale tween, no need to wait for the path to finish. The
  // earlier setTimeout-based delay also raced classifyCandidate updates:
  // if torch returned before the timer fired, applyClassificationsToBoard
  // would land first, then the delayed callback would re-run with the
  // pre-classification suggestions snapshot and overwrite the badges.
  renderBadges(suggestions, animate);

  // Redraw persistent arrows behind suggestion arrows (inserted as firstChild).
  // Must come AFTER drawing suggestions so they end up at the back of the SVG stack.
  if (lastOpponentMove) setOpponentMove(lastOpponentMove);
  if (lastMyMove) setMyLastMove(lastMyMove);
  if (lastTheoryMove) setTheoryArrow(lastTheoryMove, lastTheoryColor, lastTheoryLabel);
  if (lastDeviationMove) setDeviationArrow(lastDeviationMove, lastDeviationColor, lastDeviationLabel);
  if (lastPremoveMove) setPremoveArrow(lastPremoveMove);
}

function buildMovePath(from: string, to: string, fromPt: { x: number; y: number }, toPt: { x: number; y: number }, shortenBy: number): string {
  const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
  const rankDiff = Math.abs(parseInt(from[1]) - parseInt(to[1]));
  const isKnight = (fileDiff === 1 && rankDiff === 2) || (fileDiff === 2 && rankDiff === 1);

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
    return `M ${fromPt.x} ${fromPt.y} L ${cornerX} ${cornerY} L ${endX} ${endY}`;
  }

  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const ratio = (len - shortenBy) / len;
  return `M ${fromPt.x} ${fromPt.y} L ${fromPt.x + dx * ratio} ${fromPt.y + dy * ratio}`;
}

export function setOpponentMove(move: { uci: string; classification?: MoveClassification } | null) {
  lastOpponentMove = move;
  opponentMoveGroup?.remove();
  opponentMoveGroup = null;
  if (!streamOpenReady() || isStreamOpen()) return;
  const settings = useSettingsStore.getState();
  if (!move || !arrowGroup || !settings.showOpponentArrow) return;

  const from = move.uci.slice(0, 2);
  const to = move.uci.slice(2, 4);
  const fromPt = getSquareCenter(from);
  const toPt = getSquareCenter(to);
  if (!fromPt || !toPt) return;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('data-opponent-move', move.uci);

  const thickness = Math.max(4, Math.round(squareSize / 12));
  const markerColor = settings.opponentArrowColor;
  const markerId = 'chessr-marker-opp';
  // Always recreate so color changes take effect immediately.
  defs?.querySelector(`#${markerId}`)?.remove();
  if (defs) {
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
    polygon.setAttribute('fill', markerColor);
    marker.appendChild(polygon);
    defs.appendChild(marker);
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', buildMovePath(from, to, fromPt, toPt, thickness * 2));
  path.setAttribute('stroke', markerColor);
  path.setAttribute('stroke-width', `${thickness}`);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.55');
  path.setAttribute('marker-end', `url(#${markerId})`);
  g.appendChild(path);

  // Classification badge if available — stacked below any badges other
  // sources already placed on this square (e.g. my-last-move on a recapture).
  if (move.classification && CLASSIFICATION_LABEL[move.classification]) {
    const badge = makeBadge(toPt, CLASSIFICATION_LABEL[move.classification], CLASSIFICATION_COLOR[move.classification], occupiedBadgeSlots(to), false);
    g.appendChild(badge);
  }

  arrowGroup.insertBefore(g, arrowGroup.firstChild);
  opponentMoveGroup = g;
}

export function setMyLastMove(move: { uci: string; classification?: MoveClassification } | null) {
  lastMyMove = move;
  myLastMoveGroup?.remove();
  myLastMoveGroup = null;
  if (!streamOpenReady() || isStreamOpen()) return;
  if (!move || !arrowGroup) return;
  if (!useSettingsStore.getState().showMyLastMove) return;

  const from = move.uci.slice(0, 2);
  const to = move.uci.slice(2, 4);
  const fromPt = getSquareCenter(from);
  const toPt = getSquareCenter(to);
  if (!fromPt || !toPt) return;

  const arrowColor = move.classification ? CLASSIFICATION_COLOR[move.classification] : '#aaaaaa';

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('data-my-last-move', move.uci);

  const thickness = Math.max(4, Math.round(squareSize / 12));
  const markerId = 'chessr-marker-mylast';
  defs?.querySelector(`#${markerId}`)?.remove();
  if (defs) {
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
    polygon.setAttribute('fill', arrowColor);
    marker.appendChild(polygon);
    defs.appendChild(marker);
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', buildMovePath(from, to, fromPt, toPt, thickness * 2));
  path.setAttribute('stroke', arrowColor);
  path.setAttribute('stroke-width', `${thickness}`);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.65');
  path.setAttribute('marker-end', `url(#${markerId})`);
  g.appendChild(path);

  if (move.classification && CLASSIFICATION_LABEL[move.classification]) {
    const badge = makeBadge(toPt, CLASSIFICATION_LABEL[move.classification], arrowColor, occupiedBadgeSlots(to), false);
    g.appendChild(badge);
  }

  arrowGroup.insertBefore(g, arrowGroup.firstChild);
  myLastMoveGroup = g;
}


/** Shared renderer for the theory + deviation book arrows. Same geometry
 *  as suggestion arrows (drawArrow) — only the color differs. Returns the
 *  drawn group, or null when the move can't be placed. Handles the
 *  suggestion-dedup rule: if a suggestion arrow already shows this exact
 *  move, no second arrow is drawn — the label merges into that
 *  suggestion's badge stack via renderBadges (see buildSuggestionBadges). */
function drawBookArrow(uci: string, color: string, markerId: string, dataAttr: string, label?: string): SVGGElement | null {
  if (!streamOpenReady() || isStreamOpen()) return null;
  const board = getBoard();
  if (!board) return null;
  // Staleness check — on a rematch chess.com swaps the board node,
  // leaving our overlay attached to a detached element. Drawing into it
  // silently produces an invisible arrow. (Size changes are left to the
  // ResizeObserver in renderArrows, which also redraws suggestions.)
  if (!overlay || !overlay.isConnected || overlay.parentElement !== board) {
    createOverlay(board);
  }
  if (!arrowGroup) return null;

  // Book arrows are often drawn before the first renderArrows of the game
  // (the opening tracker reacts to a move instantly, engine suggestions
  // take ~1s) — so `flipped` can still hold the previous orientation.
  // Sync it from the store or a black player gets mirrored arrows.
  flipped = useGameStore.getState().playerColor === 'black';

  if (lastSuggestions.some((s) => s.move === uci)) {
    renderBadges(lastSuggestions, false);
    return null;
  }
  // Move is off the suggestion set (or badges are stale) — refresh stacks
  // so a previously merged badge disappears from them.
  if (lastSuggestions.length) renderBadges(lastSuggestions, false);

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const fromPt = getSquareCenter(from);
  const toPt = getSquareCenter(to);
  if (!fromPt || !toPt) return null;

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute(dataAttr, uci);

  const thickness = Math.max(5, Math.round(squareSize / 10));
  defs?.querySelector(`#${markerId}`)?.remove();
  if (defs) {
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
    polygon.setAttribute('fill', color);
    marker.appendChild(polygon);
    defs.appendChild(marker);
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', buildMovePath(from, to, fromPt, toPt, thickness * 2));
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', `${thickness}`);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.85');
  path.setAttribute('marker-end', `url(#${markerId})`);
  g.appendChild(path);

  // Opening name label — same badge style/position as suggestion badges,
  // stacked below badges other sources already placed on this square.
  if (label) {
    g.appendChild(makeBadge(toPt, label.slice(0, 5), color, occupiedBadgeSlots(to), false));
  }

  arrowGroup.appendChild(g);
  return g;
}

export function setTheoryArrow(uci: string, color: string, label?: string) {
  lastTheoryMove = uci;
  lastTheoryColor = color;
  lastTheoryLabel = label;
  theoryArrowGroup?.remove();
  theoryArrowGroup = null;
  theoryArrowGroup = drawBookArrow(uci, color, 'chessr-marker-theory', 'data-theory-move', label);
}

export function clearTheoryArrow() {
  const hadLabel = lastTheoryLabel !== undefined;
  lastTheoryMove = null;
  lastTheoryLabel = undefined;
  theoryArrowGroup?.remove();
  theoryArrowGroup = null;
  // Drop the merged theory badge from any suggestion stack it was on.
  if (hadLabel && arrowGroup && lastSuggestions.length) renderBadges(lastSuggestions, false);
}

export function setDeviationArrow(uci: string, color: string, label?: string) {
  lastDeviationMove = uci;
  lastDeviationColor = color;
  lastDeviationLabel = label;
  deviationArrowGroup?.remove();
  deviationArrowGroup = null;
  deviationArrowGroup = drawBookArrow(uci, color, 'chessr-marker-deviation', 'data-deviation-move', label);
}

/** Arrow for a premove queued by Chessr (hotkey + modifier, or
 *  auto-premove). Unlike book arrows there is no suggestion-merge rule —
 *  the premove displays during the opponent's turn, when suggestion
 *  arrows for our next move aren't on the board. */
export function setPremoveArrow(uci: string) {
  lastPremoveMove = uci;
  premoveArrowGroup?.remove();
  premoveArrowGroup = null;
  if (!streamOpenReady() || isStreamOpen()) return;
  const settings = useSettingsStore.getState();
  if (!settings.showPremoveArrow) return;
  const board = getBoard();
  if (!board) return;
  // Premoves are queued during the opponent's turn, sometimes before the
  // first renderArrows of the game — same staleness/orientation caveats
  // as book arrows (see drawBookArrow).
  if (!overlay || !overlay.isConnected || overlay.parentElement !== board) {
    createOverlay(board);
  }
  if (!arrowGroup) return;
  flipped = useGameStore.getState().playerColor === 'black';

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const fromPt = getSquareCenter(from);
  const toPt = getSquareCenter(to);
  if (!fromPt || !toPt) return;

  const color = settings.premoveArrowColor;
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('data-premove-move', uci);

  const thickness = Math.max(5, Math.round(squareSize / 10));
  const markerId = 'chessr-marker-premove';
  // Always recreate so color changes take effect immediately.
  defs?.querySelector(`#${markerId}`)?.remove();
  if (defs) {
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
    polygon.setAttribute('fill', color);
    marker.appendChild(polygon);
    defs.appendChild(marker);
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', buildMovePath(from, to, fromPt, toPt, thickness * 2));
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', `${thickness}`);
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('fill', 'none');
  path.setAttribute('opacity', '0.85');
  path.setAttribute('marker-end', `url(#${markerId})`);
  g.appendChild(path);

  g.appendChild(makeBadge(toPt, 'Premove', color, occupiedBadgeSlots(to), false));

  arrowGroup.appendChild(g);
  premoveArrowGroup = g;
}

export function clearPremoveArrow() {
  lastPremoveMove = null;
  premoveArrowGroup?.remove();
  premoveArrowGroup = null;
}

export function clearDeviationArrow() {
  const hadLabel = lastDeviationLabel !== undefined;
  lastDeviationMove = null;
  lastDeviationLabel = undefined;
  deviationArrowGroup?.remove();
  deviationArrowGroup = null;
  if (hadLabel && arrowGroup && lastSuggestions.length) renderBadges(lastSuggestions, false);
}

export function clearArrows() {
  lastSuggestions = [];
  // NOTE: intentionally does NOT clear lastOpponentMove / opponentMoveGroup.
  // The opponent arrow should persist while the engine recomputes suggestions.
  // Call setOpponentMove(null) explicitly when the player moves or game ends.
  arrowsByFrom.clear();
  badgeGroupByMove.clear();
  if (!arrowGroup) return;
  // Fade out suggestion arrows only — skip the opponent move and my-last-move groups.
  const children = Array.from(arrowGroup.children).filter((c) => c !== opponentMoveGroup && c !== myLastMoveGroup && c !== theoryArrowGroup && c !== deviationArrowGroup && c !== premoveArrowGroup);
  if (!children.length) return;

  if (useSettingsStore.getState().disableAnimations) {
    for (const c of children) c.remove();
    // Only wipe defs if nothing else is left in arrowGroup — otherwise
    // we'd kill markers used by arrows that arrived in the meantime.
    if (defs && arrowGroup.children.length === 0) defs.innerHTML = '';
    return;
  }

  gsap.to(children, {
    opacity: 0,
    duration: 0.15,
    ease: 'power2.in',
    onComplete: () => {
      // Only remove the children we captured at call time. A renderArrows()
      // that ran during the fade-out has already added new arrows to the
      // arrowGroup — wiping innerHTML here would kill them too (race we
      // see on Lichess puzzles when a wrong move is reverted in <150 ms
      // and a fresh search resolves into the brief gap).
      for (const c of children) {
        if (c.parentNode === arrowGroup) c.remove();
      }
      if (defs && arrowGroup && arrowGroup.children.length === 0) {
        defs.innerHTML = '';
      }
    },
  });
}

/** Remove the opponent-move and my-last-move DOM groups without clearing
 *  their stored state. Called when stream mode opens so existing arrows
 *  on the host board disappear immediately. */
export function clearPersistentArrows(): void {
  opponentMoveGroup?.remove();
  opponentMoveGroup = null;
  myLastMoveGroup?.remove();
  myLastMoveGroup = null;
  theoryArrowGroup?.remove();
  theoryArrowGroup = null;
  deviationArrowGroup?.remove();
  deviationArrowGroup = null;
  premoveArrowGroup?.remove();
  premoveArrowGroup = null;
}

/** Redraw the opponent-move, my-last-move, and theory arrows from the last known
 *  state. Called when stream mode closes so these persistent arrows
 *  reappear on the host board without waiting for the next move. */
export function redrawPersistentArrows(): void {
  if (lastOpponentMove) setOpponentMove(lastOpponentMove);
  if (lastMyMove) setMyLastMove(lastMyMove);
  if (lastTheoryMove) setTheoryArrow(lastTheoryMove, lastTheoryColor, lastTheoryLabel);
  if (lastDeviationMove) setDeviationArrow(lastDeviationMove, lastDeviationColor, lastDeviationLabel);
  if (lastPremoveMove) setPremoveArrow(lastPremoveMove);
}

/**
 * Translate a clientX/clientY pointer position to an algebraic square name
 * (e.g. "e4") using the overlay's known flipped state and square size, or
 * null if the pointer lies outside the board.
 */
export function cursorToSquare(clientX: number, clientY: number): string | null {
  const board = getBoard();
  if (!board || squareSize <= 0) return null;
  const rect = board.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.width) return null;
  const col = Math.floor(x / squareSize);
  const row = Math.floor(y / squareSize);
  const file = flipped ? 7 - col : col;
  const rank = flipped ? row : 7 - row;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return String.fromCharCode(97 + file) + (rank + 1);
}

/**
 * Convert clientX/clientY into the overlay's local coordinate system (the
 * same basis used by drawArrow / applyProgress). Returns null if the board
 * isn't mounted yet.
 */
export function cursorToOverlayCoords(clientX: number, clientY: number): { x: number; y: number } | null {
  const board = getBoard();
  if (!board) return null;
  const rect = board.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

/**
 * Return true iff we've drawn at least one arrow starting from `from`.
 * Drag layer uses this to bail cheaply when the user grabs a non-suggestion piece.
 */
export function hasArrowFrom(from: string): boolean {
  return arrowsByFrom.has(from);
}

function applyProgress(a: DrawnArrow, progress: number): void {
  const p = Math.max(0, Math.min(1, progress));

  if (p >= 0.98) {
    a.path.setAttribute('opacity', '0');
    return;
  }
  a.path.setAttribute('opacity', '0.85');

  let d: string;
  if (a.corner && a.segA !== undefined && a.segB !== undefined) {
    // Knight L-path: consume the progress along segment A first, then B.
    const consumed = a.totalLen * p;
    if (consumed <= a.segA) {
      const t = a.segA > 0 ? consumed / a.segA : 0;
      const sx = a.fromPt.x + (a.corner.x - a.fromPt.x) * t;
      const sy = a.fromPt.y + (a.corner.y - a.fromPt.y) * t;
      d = `M ${sx} ${sy} L ${a.corner.x} ${a.corner.y} L ${a.toPt.x} ${a.toPt.y}`;
    } else {
      const t = a.segB > 0 ? (consumed - a.segA) / a.segB : 1;
      const sx = a.corner.x + (a.toPt.x - a.corner.x) * t;
      const sy = a.corner.y + (a.toPt.y - a.corner.y) * t;
      d = `M ${sx} ${sy} L ${a.toPt.x} ${a.toPt.y}`;
    }
  } else {
    const sx = a.fromPt.x + (a.toPt.x - a.fromPt.x) * p;
    const sy = a.fromPt.y + (a.toPt.y - a.fromPt.y) * p;
    d = `M ${sx} ${sy} L ${a.toPt.x} ${a.toPt.y}`;
  }
  a.path.setAttribute('d', d);
}

/**
 * Update every arrow originating from `from` based on the pointer position
 * (overlay-local coordinates). Each arrow shrinks proportionally to how much
 * cursor distance remains between it and the arrow's own destination.
 *
 *   progress = 1 − (dist(cursor, arrow.end) / dist(arrow.start, arrow.end))
 *
 * Works intuitively for both straight and L-shaped (knight) arrows. Arrows
 * that target different squares shrink independently — so when you grab a
 * piece with 3 multipv arrows, each arrow tracks its own destination.
 */
export function updateArrowsForDrag(from: string, cursorX: number, cursorY: number): void {
  const list = arrowsByFrom.get(from);
  if (!list) return;
  for (const a of list) {
    const total = Math.sqrt((a.toPt.x - a.fromPt.x) ** 2 + (a.toPt.y - a.fromPt.y) ** 2);
    if (total === 0) { applyProgress(a, 0); continue; }
    const remaining = Math.sqrt((a.toPt.x - cursorX) ** 2 + (a.toPt.y - cursorY) ** 2);
    applyProgress(a, 1 - remaining / total);
  }
}

/** Restore every arrow originating from `from` to its full drawn length. */
export function resetArrowDragProgress(from: string): void {
  const list = arrowsByFrom.get(from);
  if (!list) return;
  for (const a of list) applyProgress(a, 0);
}

/**
 * Render PV continuation arrows on the board.
 * Alternates white/black arrows with decreasing opacity.
 * Clears existing suggestion arrows first.
 */
export function renderPvArrows(pv: string[], isFlipped: boolean, playerIsWhite: boolean) {
  if (!streamOpenReady()) return;
  // Same Stream Mode gate as renderArrows. PV arrows are a separate
  // entry point — without this guard, a fresh game triggers the PV
  // path before renderArrows can clear, and the overlay flashes back
  // onto the host board on stream.
  if (isStreamOpen()) {
    clearArrows();
    return;
  }

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
