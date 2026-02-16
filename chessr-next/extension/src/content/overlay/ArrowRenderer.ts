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
}

export class ArrowRenderer {
  private overlay: OverlayManager;

  constructor(overlay: OverlayManager) {
    this.overlay = overlay;
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
    const { from, to, color, opacity = 0.85 } = options;

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

    // Check if this is a knight move - use L-shaped arrow
    if (this.isKnightMove(from, to)) {
      return this.drawLShapedArrow(fromPos, toPos, color, thickness, opacity, markerId, layer, shortenAmount);
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
    return line;
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
  }
}
