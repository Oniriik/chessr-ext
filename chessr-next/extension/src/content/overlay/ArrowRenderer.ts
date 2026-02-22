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
  private selectedIndex: number = 0; // 0-based index of selected suggestion

  constructor(overlay: OverlayManager) {
    this.overlay = overlay;
  }

  /**
   * Set the selected suggestion index (from sidebar)
   */
  setSelectedIndex(index: number): void {
    this.selectedIndex = index;
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

    // Get or create badge info for this square
    let info = this.squareBadges.get(toSquare);
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

    // Always redraw badges for this square (handles both single and multiple arrows)
    this.redrawSquareBadges(toSquare, toPos);
  }

  /**
   * Redraw badges for a square
   * For single arrow: show badges on right
   * For multiple arrows (conflict): show rank badges on right, active badges on left
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
    const squareLeft = toPos.x - squareSize / 2;
    const squareTop = toPos.y - squareSize / 2;

    const isConflict = info.ranks.length > 1;

    if (!isConflict) {
      // Single arrow - just draw badges on right
      const rank = info.ranks[0];
      const badges = info.badges.get(rank) || [];
      const badgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      badgesGroup.setAttribute('data-square', toSquare);

      let currentY = squareTop + squarePadding;
      for (const badgeText of badges) {
        const colors = this.getBadgeColor(badgeText);
        const badgeGroup = this.drawBadge(
          { x: squareRight - squarePadding, y: currentY },
          badgeText,
          colors.bg,
          colors.text,
          scale
        );
        badgesGroup.appendChild(badgeGroup);
        const bbox = badgeGroup.getBBox();
        currentY += bbox.height + spacing;
      }

      layer.appendChild(badgesGroup);
      info.currentY = currentY;
      return;
    }

    // Multiple arrows (conflict mode)
    // Disabled badge color (gray like sidebar)
    const disabledColor = 'rgba(75, 85, 99, 0.8)';

    // Container for rank badges (right side)
    const rankBadgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    rankBadgesGroup.setAttribute('data-square', toSquare);
    rankBadgesGroup.setAttribute('class', 'rank-badges-container');

    // Container for active badges (left side) - shared across all ranks
    const activeBadgesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    activeBadgesGroup.setAttribute('data-square', toSquare);
    activeBadgesGroup.setAttribute('class', 'active-badges-container');

    let currentY = squareTop + squarePadding;
    const rankElements: Map<number, { rect: SVGRectElement; text: SVGTextElement; y: number }> = new Map();

    // Sort ranks to display in order #1, #2, #3
    const sortedRanks = [...info.ranks].sort((a, b) => a - b);

    // Draw rank badges for each move
    for (const rank of sortedRanks) {
      const arrowColor = info.color.get(rank) || 'rgba(107, 114, 128, 0.95)';
      const isActive = (rank - 1) === this.selectedIndex; // rank is 1-based, selectedIndex is 0-based
      const badgeColor = isActive ? arrowColor : disabledColor;

      const { rect, text, height } = this.createRankBadge(
        { x: squareRight - squarePadding, y: currentY },
        rank,
        badgeColor,
        scale
      );

      rankBadgesGroup.appendChild(rect);
      rankBadgesGroup.appendChild(text);
      rankElements.set(rank, { rect, text, y: currentY });

      currentY += height + spacing;
    }

    // Draw active badges on the left for the selected rank
    const selectedRank = this.selectedIndex + 1; // Convert to 1-based
    if (info.ranks.includes(selectedRank)) {
      this.drawActiveBadgesLeft(activeBadgesGroup, info.badges.get(selectedRank) || [], squareLeft + squarePadding, squareTop + squarePadding, scale);
    }

    // Add hover events to make rank badges interactive
    for (const rank of sortedRanks) {
      const arrowColor = info.color.get(rank) || 'rgba(107, 114, 128, 0.95)';
      const badges = info.badges.get(rank) || [];
      const elem = rankElements.get(rank);
      if (!elem) continue;

      const { rect } = elem;

      // Make clickable area
      rect.style.cursor = 'pointer';
      rect.style.pointerEvents = 'auto';

      rect.addEventListener('mouseenter', () => {
        // Highlight this badge as active
        rect.setAttribute('fill', arrowColor);

        // Update left badges to show this rank's badges
        while (activeBadgesGroup.firstChild) {
          activeBadgesGroup.removeChild(activeBadgesGroup.firstChild);
        }
        this.drawActiveBadgesLeft(activeBadgesGroup, badges, squareLeft + squarePadding, squareTop + squarePadding, scale);

        // Dim other rank badges
        for (const [otherRank, otherElem] of rankElements) {
          if (otherRank !== rank) {
            otherElem.rect.setAttribute('fill', disabledColor);
          }
        }
      });

      rect.addEventListener('mouseleave', () => {
        // Restore based on selectedIndex
        const selectedRank = this.selectedIndex + 1;
        for (const [r, e] of rankElements) {
          const isSelected = r === selectedRank;
          e.rect.setAttribute('fill', isSelected ? (info.color.get(r) || disabledColor) : disabledColor);
        }

        // Restore left badges to show selected rank's badges
        while (activeBadgesGroup.firstChild) {
          activeBadgesGroup.removeChild(activeBadgesGroup.firstChild);
        }
        if (info.ranks.includes(selectedRank)) {
          this.drawActiveBadgesLeft(activeBadgesGroup, info.badges.get(selectedRank) || [], squareLeft + squarePadding, squareTop + squarePadding, scale);
        }
      });
    }

    layer.appendChild(rankBadgesGroup);
    layer.appendChild(activeBadgesGroup);

    info.currentY = currentY;
  }

  /**
   * Create a rank badge element (#1, #2, etc.)
   */
  private createRankBadge(
    position: { x: number; y: number },
    rank: number,
    color: string,
    scale: number
  ): { rect: SVGRectElement; text: SVGTextElement; height: number } {
    const layer = this.overlay.getArrowsLayer()!;

    const fontSize = Math.max(8, Math.round(11 * scale));
    const padding = Math.max(2, Math.round(3 * scale));
    const borderRadius = Math.max(2, Math.round(3 * scale));

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

    return { rect, text: textElement, height: rectHeight };
  }

  /**
   * Draw active badges on the left side of the square
   */
  private drawActiveBadgesLeft(
    container: SVGGElement,
    badges: string[],
    startX: number,
    startY: number,
    scale: number
  ): void {
    const layer = this.overlay.getArrowsLayer();
    if (!layer) return;

    const spacing = Math.max(1, Math.round(1 * scale));
    let currentY = startY;

    for (const badgeText of badges) {
      const colors = this.getBadgeColor(badgeText);
      const badgeGroup = this.drawBadgeElementLeft(
        { x: startX, y: currentY },
        badgeText,
        colors.bg,
        colors.text,
        scale
      );
      container.appendChild(badgeGroup);
      const bbox = badgeGroup.getBBox();
      currentY += bbox.height + spacing;
    }
  }

  /**
   * Draw a badge element aligned to left (for hover popup)
   */
  private drawBadgeElementLeft(
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
    // Position from left edge
    const rectX = position.x;

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
