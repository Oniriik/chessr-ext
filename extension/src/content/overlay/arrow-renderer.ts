import { OverlayManager } from './overlay-manager';

interface ArrowOptions {
  from: string;
  to: string;
  color: string;  // Hex color
  thickness?: number;
  opacity?: number;
  badges?: string[];  // All badges (label + sub-badges)
}

export class ArrowRenderer {
  private overlay: OverlayManager;

  constructor(overlay: OverlayManager) {
    this.overlay = overlay;
  }

  private isKnightMove(from: string, to: string): boolean {
    const fileDiff = Math.abs(from.charCodeAt(0) - to.charCodeAt(0));
    const rankDiff = Math.abs(parseInt(from[1]) - parseInt(to[1]));
    return (fileDiff === 1 && rankDiff === 2) || (fileDiff === 2 && rankDiff === 1);
  }

  private getBadgeColor(badgeText: string): string {
    // Main labels
    if (badgeText.includes('Best')) return 'rgba(34, 197, 94, 0.95)'; // Green
    if (badgeText.includes('Safe')) return 'rgba(59, 130, 246, 0.95)'; // Blue
    if (badgeText.includes('Risky') || badgeText.includes('⚠')) return 'rgba(239, 68, 68, 0.95)'; // Red
    if (badgeText.includes('Human')) return 'rgba(168, 85, 247, 0.95)'; // Purple
    if (badgeText.includes('Alt')) return 'rgba(107, 114, 128, 0.95)'; // Gray

    // Sub-badges
    if (badgeText.includes('Mate') || badgeText.includes('#')) return 'rgba(249, 115, 22, 0.95)'; // Orange
    if (badgeText.includes('Check') || badgeText.includes('+')) return 'rgba(234, 179, 8, 0.95)'; // Yellow
    if (badgeText.includes('Capture') || badgeText.includes('x')) return 'rgba(236, 72, 153, 0.95)'; // Pink
    if (badgeText.includes('Promo') || badgeText.includes('♛')) return 'rgba(99, 102, 241, 0.95)'; // Indigo

    // Default
    return 'rgba(75, 85, 99, 0.95)'; // Gray
  }

  private drawBadgesForArrow(fromPos: { x: number; y: number }, toPos: { x: number; y: number }, badges: string[]): void {
    const layer = this.overlay.getArrowsLayer();
    if (!layer) return;

    if (badges.length === 0) return;

    const squareSize = this.overlay.getSquareSize();
    const boardSize = squareSize * 8;

    // Calculate arrow direction and position
    const dx = Math.abs(toPos.x - fromPos.x);
    const dy = Math.abs(toPos.y - fromPos.y);
    const isVertical = dy > dx; // More vertical than horizontal

    // Determine which half of the board the arrow is in
    const centerX = boardSize / 2;
    const centerY = boardSize / 2;
    const arrowCenterX = (fromPos.x + toPos.x) / 2;
    const arrowCenterY = (fromPos.y + toPos.y) / 2;

    const isLeftHalf = arrowCenterX < centerX;
    const isTopHalf = arrowCenterY < centerY;

    const spacing = 6; // Space between badges
    const offset = squareSize * 0.3; // Base offset from arrow

    if (isVertical) {
      // Vertical arrow: display badges vertically
      const offsetX = isLeftHalf ? offset : -offset; // Right if left half, left if right half
      const startY = toPos.y + squareSize * 0.15;

      let currentY = startY;
      for (const badgeText of badges) {
        const badgeColor = this.getBadgeColor(badgeText);
        const badgeGroup = this.drawBadge(
          { x: toPos.x + offsetX, y: currentY },
          badgeText,
          badgeColor
        );
        layer.appendChild(badgeGroup);

        const bbox = badgeGroup.getBBox();
        currentY += bbox.height + spacing;
      }
    } else {
      // Horizontal arrow: display badges horizontally
      const offsetY = isTopHalf ? squareSize * 0.5 : -squareSize * 0.5; // Bottom if top half, top if bottom half
      const startX = toPos.x - (badges.length * 30) / 2; // Center badges horizontally

      let currentX = startX;
      for (const badgeText of badges) {
        const badgeColor = this.getBadgeColor(badgeText);
        const badgeGroup = this.drawBadge(
          { x: currentX, y: toPos.y + offsetY },
          badgeText,
          badgeColor
        );
        layer.appendChild(badgeGroup);

        const bbox = badgeGroup.getBBox();
        currentX += bbox.width + spacing;
      }
    }
  }

  private drawBadge(position: { x: number; y: number }, text: string, badgeColor: string): SVGGElement {
    const layer = this.overlay.getArrowsLayer();
    if (!layer) return document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Create text element to measure size
    const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textElement.setAttribute('x', position.x.toString());
    textElement.setAttribute('y', position.y.toString());
    textElement.setAttribute('text-anchor', 'middle');
    textElement.setAttribute('dominant-baseline', 'middle');
    textElement.setAttribute('font-size', '12');
    textElement.setAttribute('font-weight', 'bold');
    textElement.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    textElement.setAttribute('fill', 'white');
    textElement.textContent = text;

    // Add temporary to measure
    layer.appendChild(textElement);
    const bbox = textElement.getBBox();
    layer.removeChild(textElement);

    // Create background rectangle
    const padding = 4;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (position.x - bbox.width / 2 - padding).toString());
    rect.setAttribute('y', (position.y - bbox.height / 2 - padding).toString());
    rect.setAttribute('width', (bbox.width + padding * 2).toString());
    rect.setAttribute('height', (bbox.height + padding * 2).toString());
    rect.setAttribute('rx', '4');
    rect.setAttribute('ry', '4');
    rect.setAttribute('fill', badgeColor);
    rect.setAttribute('opacity', '0.95');

    group.appendChild(rect);
    group.appendChild(textElement);

    return group;
  }

  private drawArrowWithColor(options: ArrowOptions): SVGElement | null {
    const { from, to, color, thickness = 8, opacity = 0.8, badges } = options;

    const layer = this.overlay.getArrowsLayer();
    if (!layer) return null;

    const fromPos = this.overlay.getSquareCenter(from);
    const toPos = this.overlay.getSquareCenter(to);

    // Create unique marker for this color
    const markerId = `arrow-marker-${color.replace('#', '')}`;
    this.ensureMarker(markerId, color);

    // Check if this is a knight move - use L-shaped arrow
    if (this.isKnightMove(from, to)) {
      const arrow = this.drawLShapedArrow(fromPos, toPos, color, thickness, opacity, markerId, layer);

      // Draw badges if provided
      if (badges && badges.length > 0) {
        this.drawBadgesForArrow(fromPos, toPos, badges);
      }

      return arrow;
    }

    // Straight arrow for non-knight moves
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const shortenBy = thickness + 5;
    const ratio = (length - shortenBy) / length;

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

    // Draw badges if provided
    if (badges && badges.length > 0) {
      this.drawBadgesForArrow(fromPos, toPos, badges);
    }

    return line;
  }

  private drawLShapedArrow(
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    color: string,
    thickness: number,
    opacity: number,
    markerId: string,
    layer: SVGGElement
  ): SVGPathElement {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;

    // Determine corner point for L-shape
    // Knight moves: go along the longer dimension first, then shorter
    let cornerX: number, cornerY: number;

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal dominant (2 squares horizontal, 1 vertical)
      // Go horizontal first, then vertical
      cornerX = toPos.x;
      cornerY = fromPos.y;
    } else {
      // Vertical dominant (2 squares vertical, 1 horizontal)
      // Go vertical first, then horizontal
      cornerX = fromPos.x;
      cornerY = toPos.y;
    }

    // Shorten the end point to make room for arrowhead
    const endDx = toPos.x - cornerX;
    const endDy = toPos.y - cornerY;
    const endLength = Math.sqrt(endDx * endDx + endDy * endDy);
    const shortenBy = thickness + 5;

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

  private ensureMarker(markerId: string, color: string) {
    const svg = this.overlay.getSVG();
    if (!svg) return;

    // Check if marker already exists
    if (svg.querySelector(`#${markerId}`)) return;

    const defs = svg.querySelector('defs');
    if (!defs) return;

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refX', '2.5');
    marker.setAttribute('refY', '2');
    marker.setAttribute('orient', 'auto');

    const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    polygon.setAttribute('points', '0 0, 4 2, 0 4');
    polygon.setAttribute('fill', color);

    marker.appendChild(polygon);
    defs.appendChild(marker);
  }
}
