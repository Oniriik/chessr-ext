import { PlatformAdapter } from '../platforms/types';

export class OverlayManager {
  private adapter: PlatformAdapter | null = null;
  private svg: SVGSVGElement | null = null;
  private boardElement: HTMLElement | null = null;
  private isFlipped = false;
  private squareSize = 0;

  initialize(boardElement: HTMLElement, isFlipped: boolean, adapter?: PlatformAdapter) {
    this.boardElement = boardElement;
    this.isFlipped = isFlipped;
    if (adapter) {
      this.adapter = adapter;
    }
    this.createSVG();
    this.setupResizeObserver();
  }

  private createSVG() {
    if (!this.boardElement) return;

    // Remove existing overlay
    this.svg?.remove();
    document.querySelector('.chessr-overlay')?.remove();

    // Use adapter if available, otherwise fall back to direct DOM queries
    if (this.adapter) {
      this.squareSize = this.adapter.getSquareSize(this.boardElement);
      if (this.squareSize === 0) return;

      const origin = this.adapter.getBoardOrigin(this.boardElement, this.squareSize, this.isFlipped);
      this.createSVGElement(origin.x, origin.y);
      return;
    }

    // Fallback: direct DOM queries (for backwards compatibility)
    const pieces = document.querySelectorAll('.piece');
    if (pieces.length === 0) return;

    const boardRect = this.boardElement.getBoundingClientRect();
    const firstPiece = pieces[0] as HTMLElement;
    const pieceRect = firstPiece.getBoundingClientRect();
    this.squareSize = pieceRect.width;

    let originX = 0, originY = 0;
    for (const piece of pieces) {
      const classList = Array.from(piece.classList);
      const squareClass = classList.find(c => c.startsWith('square-'));
      if (!squareClass) continue;

      const squareNum = parseInt(squareClass.replace('square-', ''));
      const fileNum = Math.floor(squareNum / 10) - 1;
      const rankNum = (squareNum % 10) - 1;

      const pRect = piece.getBoundingClientRect();
      const pieceX = pRect.left - boardRect.left;
      const pieceY = pRect.top - boardRect.top;

      if (this.isFlipped) {
        originX = pieceX - (7 - fileNum) * this.squareSize;
        originY = pieceY - rankNum * this.squareSize;
      } else {
        originX = pieceX - fileNum * this.squareSize;
        originY = pieceY - (7 - rankNum) * this.squareSize;
      }

      break;
    }

    this.createSVGElement(originX, originY);
  }

  private createSVGElement(originX: number, originY: number) {
    if (!this.boardElement) return;

    const boardWidth = this.squareSize * 8;
    const boardHeight = this.squareSize * 8;

    // Create SVG with board dimensions positioned at origin
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'chessr-overlay');
    this.svg.setAttribute('width', boardWidth.toString());
    this.svg.setAttribute('height', boardHeight.toString());
    this.svg.setAttribute('viewBox', `0 0 ${boardWidth} ${boardHeight}`);
    this.svg.style.cssText = `
      position: absolute;
      top: ${originY}px;
      left: ${originX}px;
      width: ${boardWidth}px;
      height: ${boardHeight}px;
      pointer-events: none;
      z-index: 9999;
    `;

    // Add marker definitions for arrows
    // Using markerUnits="strokeWidth" ensures consistent proportions regardless of arrow thickness
    this.svg.innerHTML = `
      <defs>
        <marker id="arrow-green" markerUnits="strokeWidth" markerWidth="3" markerHeight="3" refX="2" refY="1.5" orient="auto">
          <polygon points="0 0, 3 1.5, 0 3" fill="rgba(0, 200, 80, 0.9)"/>
        </marker>
        <marker id="arrow-yellow" markerUnits="strokeWidth" markerWidth="3" markerHeight="3" refX="2" refY="1.5" orient="auto">
          <polygon points="0 0, 3 1.5, 0 3" fill="rgba(255, 200, 0, 0.9)"/>
        </marker>
        <marker id="arrow-blue" markerUnits="strokeWidth" markerWidth="3" markerHeight="3" refX="2" refY="1.5" orient="auto">
          <polygon points="0 0, 3 1.5, 0 3" fill="rgba(0, 120, 255, 0.9)"/>
        </marker>
        <marker id="arrow-red" markerUnits="strokeWidth" markerWidth="3" markerHeight="3" refX="2" refY="1.5" orient="auto">
          <polygon points="0 0, 3 1.5, 0 3" fill="rgba(255, 50, 50, 0.9)"/>
        </marker>
      </defs>
      <g id="arrows"></g>
      <g id="highlights"></g>
    `;

    // Find the appropriate container for the overlay
    // For Lichess, use the parent cg-container which already has position:relative
    // For Chess.com, use the board element itself
    let overlayContainer = this.boardElement;

    if (this.adapter?.platform === 'lichess') {
      // Lichess: attach to cg-container parent (already has position:relative)
      const cgContainer = this.boardElement.closest('cg-container');
      if (cgContainer) {
        overlayContainer = cgContainer as HTMLElement;
      }
    } else {
      // Chess.com and fallback: ensure board has position:relative
      this.boardElement.style.position = 'relative';
    }

    overlayContainer.appendChild(this.svg);
  }

  private setupResizeObserver() {
    if (!this.boardElement) return;

    const observer = new ResizeObserver(() => {
      this.updateSquareSize();
    });
    observer.observe(this.boardElement);
  }

  private updateSquareSize() {
    // Recreate SVG on resize to recalculate position
    this.createSVG();
  }

  getSquareCenter(square: string): { x: number; y: number } {
    const file = square.charCodeAt(0) - 97;  // a=0, h=7
    const rank = parseInt(square[1]) - 1;     // 1=0, 8=7

    let x: number, y: number;

    if (this.isFlipped) {
      x = (7 - file) * this.squareSize + this.squareSize / 2;
      y = rank * this.squareSize + this.squareSize / 2;
    } else {
      x = file * this.squareSize + this.squareSize / 2;
      y = (7 - rank) * this.squareSize + this.squareSize / 2;
    }

    return { x, y };
  }

  getSquareSize(): number {
    return this.squareSize;
  }

  getSVG(): SVGSVGElement | null {
    return this.svg;
  }

  getArrowsLayer(): SVGGElement | null {
    return this.svg?.querySelector('#arrows') || null;
  }

  getHighlightsLayer(): SVGGElement | null {
    return this.svg?.querySelector('#highlights') || null;
  }

  clearArrows() {
    const layer = this.getArrowsLayer();
    if (layer) layer.innerHTML = '';
  }

  clearHighlights() {
    const layer = this.getHighlightsLayer();
    if (layer) layer.innerHTML = '';
  }

  clearAll() {
    this.clearArrows();
    this.clearHighlights();
  }

  setFlipped(isFlipped: boolean) {
    if (this.isFlipped !== isFlipped) {
      this.isFlipped = isFlipped;
      // Recreate SVG with new orientation
      this.createSVG();
    }
  }
}
