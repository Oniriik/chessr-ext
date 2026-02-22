/**
 * ArrowRenderer - Draws arrows on the chess board overlay
 */

import { OverlayManager } from './OverlayManager';

export interface ArrowOptions {
  from: string; // e.g., "e2"
  to: string; // e.g., "e4"
  color: string; // Hex color
  thickness?: number;
  opacity?: number;
  badges?: string[]; // Labels to display on the arrow
  rank?: number; // Move rank (1, 2, 3...)
}

interface SquareBadgeInfo {
  ranks: number[];
  badges: Map<number, string[]>; // rank -> badges
  color: Map<number, string>; // rank -> color
  currentY: number;
}

export class ArrowRenderer {
  private overlay: OverlayManager;
  private squareBadges: Map<string, SquareBadgeInfo> = new Map();

  constructor(overlay: OverlayManager) {
    this.overlay = overlay;
  }

  /**
   * Get badge colors based on text
   */
  private getBadgeColor(badgeText: string): { bg: string; text: string } {
    // Quality labels
    if (badgeText.includes('Best')) return { bg: 'rgba(34, 197, 94, 0.95)', text: 'white' };
    if (badgeText.includes('Safe')) return { bg: 'rgba(59, 130, 246, 0.95)', text: 'white' };
    if (badgeText.includes('OK')) return { bg: 'rgba(107, 114, 128, 0.95)', text: 'white' };
    if (badgeText.includes('Risky')) return { bg: 'rgba(239, 68, 68, 0.95)', text: 'white' };

    // Effect badges
    if (badgeText.includes('Mate')) return { bg: 'rgba(234, 179, 8, 0.95)', text: 'white' };
    if (badgeText.includes('Check')) return { bg: 'rgba(234, 179, 8, 0.95)', text: 'white' };
    if (badgeText.startsWith('x ')) return { bg: 'rgba(255, 255, 255, 0.95)', text: 'black' };
    if (badgeText.includes('Queen') || badgeText.includes('Rook') || badgeText.includes('Bishop') || badgeText.includes('Knight')) {
      return { bg: 'rgba(99, 102, 241, 0.95)', text: 'white' };
    }

    return { bg: 'rgba(107, 114, 128, 0.95)', text: 'white' };
  }

  /**
   * Draw badges near the arrow target with conflict handling
   */
  private drawBadges(
    toSquare: string,
    toPos: { x: number; y: number },
    badges: string[],
    rank: number,
    arrowColor: string
  ): void {
    const layer = this.overlay.getArrowsLayer();
    if (!layer || badges.length === 0) return;

    const squareSize = this.overlay.getSquareSize();
    const scale = squareSize / 100;
    const squarePadding = Math.max(2, Math.round(4 * scale));
    const squareTop = toPos.y - squareSize / 2;

    // Check if this square already has badges
    let info = this.squareBadges.get(toSquare);
    const isConflict = info !== undefined;

    if (!info) {
      info = {
        ranks: [],
        badges: new Map(),
        color: new Map(),
        currentY: squareTop + squarePadding,
      };
      this.squareBadges.set(toSquare, info);
    }

    info.ranks.push(rank);
    info.badges.set(rank, badges);
    info.color.set(rank, arrowColor);

    if (isConflict) {
      // Multiple moves to same square - redraw with rank indicators
      this.redrawSquareBadges(toSquare, toPos);
    } else {
      // First move to this square - draw full badges
      this.drawFullBadges(toSquare, toPos, badges, info);
    }
  }

  /**
   * Draw full badges for a square (when no conflict)
   */
  private drawFullBadges(
    toSquare: string,
    toPos: { x: number; y: number },
    badges: string[],
    info: SquareBadgeInfo
  ): void {
    const layer = this.overlay.getArrowsLayer();
    if (!layer) return;

    const squareSize = this.overlay.getSquareSize();
    const scale = squareSize / 100;
    const squarePadding = Math.max(2, Math.round(4 * scale));
    const spacing = Math.max(1, Math.round(1 * scale));
    const squareRight = toPos.x + squareSize / 2;

    for (const badgeText of badges) {
      const colors = this.getBadgeColor(badgeText);
      const badgeGroup = this.drawBadge(
        { x: squareRight - squarePadding, y: info.currentY },
        badgeText,
        colors.bg,
        colors.text,
        scale
      );
      // Add data-square attribute so we can remove them on conflict
      badgeGroup.setAttribute('data-square', toSquare);
      layer.appendChild(badgeGroup);

      const bbox = badgeGroup.getBBox();
      info.currentY += bbox.height + spacing;
    }
  }

  /**
   * Redraw badges for a square with rank indicators (conflict mode)
   */
  private redrawSquareBadges(toSquare: string, toPos: { x: number; y: number }): void {
    const layer = this.overlay.getArrowsLayer();
    if (!layer) return;

    const info = this.squareBadges.get(toSquare);
    if (!info) return;

    // Remove existing badges for this square
    const existingBadges = layer.querySelectorAll(`[data-square="${toSquare}"]`);
    existingBadges.forEach(el => el.remove());

    const squareSize = this.overlay.getSquareSize();
    const scale = squareSize / 100;
    const squarePadding = Math.max(2, Math.round(4 * scale));
    const spacing = Math.max(1, Math.round(1 * scale));
    const squareRight = toPos.x + squareSize / 2;
    const squareTop = toPos.y - squareSize / 2;

    let currentY = squareTop + squarePadding;

    // Draw rank badges for each move
    for (const rank of info.ranks) {
      const color = info.color.get(rank) || 'rgba(107, 114, 128, 0.95)';
      const badges = info.badges.get(rank) || [];

      const badgeGroup = this.drawRankBadgeWithHover(
        { x: squareRight - squarePadding, y: currentY },
        rank,
        badges,
        color,
        scale,
        toSquare,
        toPos
      );
      layer.appendChild(badgeGroup);

      const bbox = badgeGroup.getBBox();
      currentY += bbox.height + spacing;
    }

    info.currentY = currentY;
  }

  /**
   * Draw a rank badge with hover behavior to show full badges
   */
  private drawRankBadgeWithHover(
    position: { x: number; y: number },
    rank: number,
    badges: string[],
    color: string,
    scale: number,
    toSquare: string,
    toPos: { x: number; y: number }
  ): SVGGElement {
    const layer = this.overlay.getArrowsLayer();
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('data-square', toSquare);
    group.setAttribute('data-rank', rank.toString());
    group.style.cursor = 'pointer';
    group.style.pointerEvents = 'auto'; // Enable hover on this element even though SVG has pointer-events: none

    if (!layer) return group;

    const fontSize = Math.max(8, Math.round(11 * scale));
    const padding = Math.max(2, Math.round(3 * scale));
    const borderRadius = Math.max(2, Math.round(3 * scale));

    // Draw rank number badge
    const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textElement.setAttribute('dominant-baseline', 'central');
    textElement.setAttribute('font-size', fontSize.toString());
    textElement.setAttribute('font-weight', 'bold');
    textElement.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    textElement.setAttribute('fill', 'white');
    textElement.textContent = `#${rank}`;

    layer.appendChild(textElement);
    const bbox = textElement.getBBox();
    layer.removeChild(textElement);

    const rectHeight = bbox.height + padding * 2;
    const rectX = position.x - bbox.width - padding * 2;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', rectX.toString());
    rect.setAttribute('y', position.y.toString());
    rect.setAttribute('width', (bbox.width + padding * 2).toString());
    rect.setAttribute('height', rectHeight.toString());
    rect.setAttribute('rx', borderRadius.toString());
    rect.setAttribute('ry', borderRadius.toString());
    rect.setAttribute('fill', color);

    textElement.setAttribute('text-anchor', 'start');
    textElement.setAttribute('x', (rectX + padding).toString());
    textElement.setAttribute('y', (position.y + rectHeight / 2).toString());

    group.appendChild(rect);
    group.appendChild(textElement);

    // Create hover popup group (hidden by default)
    const popupGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    popupGroup.setAttribute('class', 'badge-popup');
    popupGroup.style.display = 'none';

    const squareSize = this.overlay.getSquareSize();
    const squarePadding = Math.max(2, Math.round(4 * scale));
    const spacing = Math.max(1, Math.round(1 * scale));
    const squareRight = toPos.x + squareSize / 2;
    let popupY = position.y;

    for (const badgeText of badges) {
      const colors = this.getBadgeColor(badgeText);
      const popupBadge = this.drawBadgeElement(
        { x: squareRight - squarePadding, y: popupY },
        badgeText,
        colors.bg,
        colors.text,
        scale
      );
      popupGroup.appendChild(popupBadge);
      const popupBbox = popupBadge.getBBox();
      popupY += popupBbox.height + spacing;
    }

    group.appendChild(popupGroup);

    // Add hover events
    group.addEventListener('mouseenter', () => {
      rect.style.display = 'none';
      textElement.style.display = 'none';
      popupGroup.style.display = 'block';
    });

    group.addEventListener('mouseleave', () => {
      rect.style.display = 'block';
      textElement.style.display = 'block';
      popupGroup.style.display = 'none';
    });

    return group;
  }

  /**
   * Draw a badge element (helper for popup)
   */
  private drawBadgeElement(
    position: { x: number; y: number },
    text: string,
    badgeColor: string,
    textColor: string,
    scale: number
  ): SVGGElement {
    const layer = this.overlay.getArrowsLayer();
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (!layer) return group;

    const fontSize = Math.max(8, Math.round(11 * scale));
    const padding = Math.max(2, Math.round(3 * scale));
    const borderRadius = Math.max(2, Math.round(3 * scale));

    const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textElement.setAttribute('dominant-baseline', 'central');
    textElement.setAttribute('font-size', fontSize.toString());
    textElement.setAttribute('font-weight', 'bold');
    textElement.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    textElement.setAttribute('fill', textColor);
    textElement.textContent = text;

    layer.appendChild(textElement);
    const bbox = textElement.getBBox();
    layer.removeChild(textElement);

    const rectHeight = bbox.height + padding * 2;
    const rectX = position.x - bbox.width - padding * 2;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', rectX.toString());
    rect.setAttribute('y', position.y.toString());
    rect.setAttribute('width', (bbox.width + padding * 2).toString());
    rect.setAttribute('height', rectHeight.toString());
    rect.setAttribute('rx', borderRadius.toString());
    rect.setAttribute('ry', borderRadius.toString());
    rect.setAttribute('fill', badgeColor);

    textElement.setAttribute('text-anchor', 'start');
    textElement.setAttribute('x', (rectX + padding).toString());
    textElement.setAttribute('y', (position.y + rectHeight / 2).toString());

    group.appendChild(rect);
    group.appendChild(textElement);

    return group;
  }

  /**
   * Draw a single badge
   */
  private drawBadge(
    position: { x: number; y: number },
    text: string,
    badgeColor: string,
    textColor: string,
    scale: number
  ): SVGGElement {
    const layer = this.overlay.getArrowsLayer();
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (!layer) return group;

    const fontSize = Math.max(8, Math.round(11 * scale));
    const padding = Math.max(2, Math.round(3 * scale));
    const borderRadius = Math.max(2, Math.round(3 * scale));

    const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textElement.setAttribute('dominant-baseline', 'central');
    textElement.setAttribute('font-size', fontSize.toString());
    textElement.setAttribute('font-weight', 'bold');
    textElement.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    textElement.setAttribute('fill', textColor);
    textElement.textContent = text;

    // Measure text
    layer.appendChild(textElement);
    const bbox = textElement.getBBox();
    layer.removeChild(textElement);

    const rectHeight = bbox.height + padding * 2;
    const rectX = position.x - bbox.width - padding * 2;

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', rectX.toString());
    rect.setAttribute('y', position.y.toString());
    rect.setAttribute('width', (bbox.width + padding * 2).toString());
    rect.setAttribute('height', rectHeight.toString());
    rect.setAttribute('rx', borderRadius.toString());
    rect.setAttribute('ry', borderRadius.toString());
    rect.setAttribute('fill', badgeColor);

    textElement.setAttribute('text-anchor', 'start');
    textElement.setAttribute('x', (rectX + padding).toString());
    textElement.setAttribute('y', (position.y + rectHeight / 2).toString());

    group.appendChild(rect);
    group.appendChild(textElement);

    return group;
  }

  /**
   * Check if a move is a knight move (L-shaped)
   */
  private isKnightMove(from: string, to: string): boolean {
    const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
    const rankDiff = Math.abs(parseInt(from[1]) - parseInt(to[1]));
    return (fileDiff === 1 && rankDiff === 2) || (fileDiff === 2 && rankDiff === 1);
  }

  /**
   * Ensure a marker exists for the given color
   */
  private ensureMarker(markerId: string, color: string): void {
    const svg = this.overlay.getSVG();
    if (!svg) return;

    // Check if marker already exists
    if (svg.querySelector(`#${markerId}`)) return;

    const defs = svg.querySelector('defs');
    if (!defs) return;

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerUnits', 'strokeWidth');
    marker.setAttribute('markerWidth', '3');
    marker.setAttribute('markerHeight', '3');
    marker.setAttribute('refX', '2');
    marker.setAttribute('refY', '1.5');
    marker.setAttribute('orient', 'auto');

    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 3 1.5, 0 3');
    polygon.setAttribute('fill', color);

    marker.appendChild(polygon);
    defs.appendChild(marker);
  }

  /**
   * Draw an arrow on the board
   */
  drawArrow(options: ArrowOptions): SVGElement | null {
    const { from, to, color, opacity = 0.85, badges } = options;

    const layer = this.overlay.getArrowsLayer();
    if (!layer) return null;

    const fromPos = this.overlay.getSquareCenter(from);
    const toPos = this.overlay.getSquareCenter(to);

    // Scale thickness based on square size
    const squareSize = this.overlay.getSquareSize();
    const scale = squareSize / 100;
    const thickness = options.thickness ?? Math.max(5, Math.round(10 * scale));
    const shortenAmount = thickness + Math.max(3, Math.round(5 * scale));

    // Create unique marker for this color
    const markerId = `arrow-marker-${color.replace('#', '').replace(/[^a-zA-Z0-9]/g, '')}`;
    this.ensureMarker(markerId, color);

    let arrow: SVGElement;

    // Check if this is a knight move - use L-shaped arrow
    if (this.isKnightMove(from, to)) {
      arrow = this.drawLShapedArrow(fromPos, toPos, color, thickness, opacity, markerId, layer, shortenAmount);
    } else {
      // Straight arrow for non-knight moves
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const ratio = (length - shortenAmount) / length;

      const endX = fromPos.x + dx * ratio;
      const endY = fromPos.y + dy * ratio;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', fromPos.x.toString());
      line.setAttribute('y1', fromPos.y.toString());
      line.setAttribute('x2', endX.toString());
      line.setAttribute('y2', endY.toString());
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', thickness.toString());
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', opacity.toString());
      line.setAttribute('marker-end', `url(#${markerId})`);

      layer.appendChild(line);
      arrow = line;
    }

    // Draw badges if provided
    if (badges && badges.length > 0) {
      const rank = options.rank ?? 1;
      this.drawBadges(to, toPos, badges, rank, color);
    }

    return arrow;
  }

  /**
   * Draw an L-shaped arrow for knight moves
   */
  private drawLShapedArrow(
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    color: string,
    thickness: number,
    opacity: number,
    markerId: string,
    layer: SVGGElement,
    shortenBy: number
  ): SVGPathElement {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;

    // Determine corner point for L-shape
    let cornerX: number, cornerY: number;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal dominant
      cornerX = toPos.x;
      cornerY = fromPos.y;
    } else {
      // Vertical dominant
      cornerX = fromPos.x;
      cornerY = toPos.y;
    }

    // Shorten the end point to make room for arrowhead
    const endDx = toPos.x - cornerX;
    const endDy = toPos.y - cornerY;
    const endLength = Math.sqrt(endDx * endDx + endDy * endDy);

    let endX: number, endY: number;
    if (endLength > 0) {
      const ratio = (endLength - shortenBy) / endLength;
      endX = cornerX + endDx * ratio;
      endY = cornerY + endDy * ratio;
    } else {
      endX = toPos.x;
      endY = toPos.y;
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${fromPos.x} ${fromPos.y} L ${cornerX} ${cornerY} L ${endX} ${endY}`);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', thickness.toString());
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('fill', 'none');
    path.setAttribute('opacity', opacity.toString());
    path.setAttribute('marker-end', `url(#${markerId})`);

    layer.appendChild(path);
    return path;
  }

  /**
   * Clear all arrows
   */
  clear(): void {
    this.overlay.clearArrows();
    this.squareBadges.clear();
  }
}
