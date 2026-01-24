import { OverlayManager } from './overlay-manager';
import { PVLine, ArrowColors } from '../../shared/types';

interface ArrowOptions {
  from: string;
  to: string;
  color: string;  // Hex color
  thickness?: number;
  opacity?: number;
}

interface DrawOptions {
  useDifferentColors: boolean;
  colors: ArrowColors;
  singleColor: string;
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

  private drawArrowWithColor(options: ArrowOptions): SVGElement | null {
    const { from, to, color, thickness = 8, opacity = 0.8 } = options;

    const layer = this.overlay.getArrowsLayer();
    if (!layer) return null;

    const fromPos = this.overlay.getSquareCenter(from);
    const toPos = this.overlay.getSquareCenter(to);

    // Create unique marker for this color
    const markerId = `arrow-marker-${color.replace('#', '')}`;
    this.ensureMarker(markerId, color);

    // Check if this is a knight move - use L-shaped arrow
    if (this.isKnightMove(from, to)) {
      return this.drawLShapedArrow(fromPos, toPos, color, thickness, opacity, markerId, layer);
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

  drawBestMoves(lines: PVLine[], options: DrawOptions) {
    this.overlay.clearArrows();

    if (!lines || lines.length === 0) return;

    const { useDifferentColors, colors, singleColor } = options;

    // Prepare arrows data (we'll draw from thinnest to thickest)
    const arrows: { from: string; to: string; color: string; thickness: number; opacity: number }[] = [];

    lines.forEach((line, index) => {
      if (!line.moves || line.moves.length === 0) return;

      const move = line.moves[0];
      if (move.length < 4) return;

      const from = move.substring(0, 2);
      const to = move.substring(2, 4);

      let color: string;
      let opacity: number;
      let thickness: number;

      if (useDifferentColors) {
        if (index === 0) {
          color = colors.best;
          opacity = 0.9;
          thickness = 8;
        } else if (index === 1) {
          color = colors.second;
          opacity = 0.5;
          thickness = 6;
        } else {
          color = colors.other;
          opacity = 0.35;
          thickness = 4;
        }
      } else {
        // Single color mode - vary only thickness
        color = singleColor;
        if (index === 0) {
          opacity = 0.9;
          thickness = 8;
        } else if (index === 1) {
          opacity = 0.5;
          thickness = 6;
        } else {
          opacity = 0.35;
          thickness = 4;
        }
      }

      arrows.push({ from, to, color, thickness, opacity });
    });

    // Sort by thickness (ascending) so thickest arrows are drawn last (on top)
    arrows.sort((a, b) => a.thickness - b.thickness);

    // Draw arrows from thinnest to thickest
    arrows.forEach(arrow => {
      this.drawArrowWithColor(arrow);
    });
  }
}
