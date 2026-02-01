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
    const scale = squareSize / 100;

    // Padding from square edge
    const squarePadding = Math.max(2, Math.round(4 * scale));
    const spacing = Math.max(1, Math.round(1 * scale));

    // Calculate square boundaries
    const squareRight = toPos.x + squareSize / 2;
    const squareTop = toPos.y - squareSize / 2;

    let currentY = squareTop + squarePadding;
    for (const badgeText of badges) {
      const badgeColor = this.getBadgeColor(badgeText);
      const badgeGroup = this.drawBadge(
        { x: squareRight - squarePadding, y: currentY },
        badgeText,
        badgeColor,
        'end',
        scale
      );
      layer.appendChild(badgeGroup);

      const bbox = badgeGroup.getBBox();
      currentY += bbox.height + spacing;
    }
  }

  private drawBadge(position: { x: number; y: number }, text: string, badgeColor: string, align: 'middle' | 'start' | 'end' = 'middle', scale: number = 1): SVGGElement {
    const layer = this.overlay.getArrowsLayer();
    if (!layer) return document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    // Scale font size and padding based on viewport (with minimums for readability)
    const fontSize = Math.max(8, Math.round(12 * scale));
    const padding = Math.max(2, Math.round(3 * scale));
    const borderRadius = Math.max(2, Math.round(3 * scale));

    // Create text element to measure size
    const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textElement.setAttribute('dominant-baseline', 'central');
    textElement.setAttribute('font-size', fontSize.toString());
    textElement.setAttribute('font-weight', 'bold');
    textElement.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    textElement.setAttribute('fill', 'white');
    textElement.textContent = text;

    // Add temporary to measure
    layer.appendChild(textElement);
    const bbox = textElement.getBBox();
    layer.removeChild(textElement);

    // Calculate rectangle position based on alignment
    const rectHeight = bbox.height + padding * 2;
    let rectX: number;
    if (align === 'start') {
      rectX = position.x;
    } else if (align === 'end') {
      rectX = position.x - bbox.width - padding * 2;
    } else {
      rectX = position.x - bbox.width / 2 - padding;
    }

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', rectX.toString());
    rect.setAttribute('y', position.y.toString());
    rect.setAttribute('width', (bbox.width + padding * 2).toString());
    rect.setAttribute('height', rectHeight.toString());
    rect.setAttribute('rx', borderRadius.toString());
    rect.setAttribute('ry', borderRadius.toString());
    rect.setAttribute('fill', badgeColor);
    rect.setAttribute('opacity', '0.85');

    // Position text centered vertically inside the rect
    textElement.setAttribute('text-anchor', 'start');
    textElement.setAttribute('x', (rectX + padding).toString());
    textElement.setAttribute('y', (position.y + rectHeight / 2).toString());

    group.appendChild(rect);
    group.appendChild(textElement);

    return group;
  }

  private drawArrowWithColor(options: ArrowOptions): SVGElement | null {
    const { from, to, color, opacity = 0.85, badges } = options;

    const layer = this.overlay.getArrowsLayer();
    if (!layer) return null;

    const fromPos = this.overlay.getSquareCenter(from);
    const toPos = this.overlay.getSquareCenter(to);

    // Scale thickness based on square size (reference: 100px square = 10px thickness)
    const squareSize = this.overlay.getSquareSize();
    const scale = squareSize / 100;
    const thickness = options.thickness ?? Math.max(5, Math.round(10 * scale));
    const shortenAmount = thickness + Math.max(3, Math.round(5 * scale));

    // Create unique marker for this color
    const markerId = `arrow-marker-${color.replace('#', '')}`;
    this.ensureMarker(markerId, color);

    // Check if this is a knight move - use L-shaped arrow
    if (this.isKnightMove(from, to)) {
      const arrow = this.drawLShapedArrow(fromPos, toPos, color, thickness, opacity, markerId, layer, shortenAmount);

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
    layer: SVGGElement,
    shortenBy: number
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
    // Use markerUnits="strokeWidth" for consistent proportions regardless of arrow thickness
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
}
