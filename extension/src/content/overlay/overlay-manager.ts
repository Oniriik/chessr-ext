export class OverlayManager {
  private svg: SVGSVGElement | null = null;
  private boardElement: HTMLElement | null = null;
  private isFlipped = false;
  private squareSize = 0;

  initialize(boardElement: HTMLElement, isFlipped: boolean) {
    this.boardElement = boardElement;
    this.isFlipped = isFlipped;
    this.createSVG();
    this.setupResizeObserver();
  }

  private createSVG() {
    if (!this.boardElement) return;

    // Remove existing overlay
    this.svg?.remove();
    document.querySelector('.chessr-overlay')?.remove();

    // Find the actual playing area by locating a piece
    const pieces = document.querySelectorAll('.piece');
    if (pieces.length === 0) return;

    // Find bounds of all pieces to determine actual board area
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const boardRect = this.boardElement.getBoundingClientRect();

    for (const piece of pieces) {
      const rect = piece.getBoundingClientRect();
      const x = rect.left - boardRect.left;
      const y = rect.top - boardRect.top;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + rect.width);
      maxY = Math.max(maxY, y + rect.height);
    }

    // Calculate square size from piece positions
    const firstPiece = pieces[0] as HTMLElement;
    const pieceRect = firstPiece.getBoundingClientRect();
    this.squareSize = pieceRect.width;  // Pieces are square-sized

    // Calculate board dimensions (8 squares)
    const boardWidth = this.squareSize * 8;
    const boardHeight = this.squareSize * 8;

    // Find top-left corner of actual board
    // Get position of a known piece to calculate origin
    let originX = 0, originY = 0;
    for (const piece of pieces) {
      const classList = Array.from(piece.classList);
      const squareClass = classList.find(c => c.startsWith('square-'));
      if (!squareClass) continue;

      const squareNum = parseInt(squareClass.replace('square-', ''));
      const fileNum = Math.floor(squareNum / 10) - 1;  // tens digit = file (0-7)
      const rankNum = (squareNum % 10) - 1;            // ones digit = rank (0-7)

      const pRect = piece.getBoundingClientRect();
      const pieceX = pRect.left - boardRect.left;
      const pieceY = pRect.top - boardRect.top;

      // Calculate origin based on this piece's position
      if (this.isFlipped) {
        originX = pieceX - (7 - fileNum) * this.squareSize;
        originY = pieceY - rankNum * this.squareSize;
      } else {
        originX = pieceX - fileNum * this.squareSize;
        originY = pieceY - (7 - rankNum) * this.squareSize;
      }

      break;
    }

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
    this.svg.innerHTML = `
      <defs>
        <marker id="arrow-green" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
          <polygon points="0 0, 4 2, 0 4" fill="rgba(0, 200, 80, 0.9)"/>
        </marker>
        <marker id="arrow-yellow" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
          <polygon points="0 0, 4 2, 0 4" fill="rgba(255, 200, 0, 0.9)"/>
        </marker>
        <marker id="arrow-blue" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
          <polygon points="0 0, 4 2, 0 4" fill="rgba(0, 120, 255, 0.9)"/>
        </marker>
        <marker id="arrow-red" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
          <polygon points="0 0, 4 2, 0 4" fill="rgba(255, 50, 50, 0.9)"/>
        </marker>
      </defs>
      <g id="arrows"></g>
      <g id="highlights"></g>
    `;

    // Attach SVG to board element
    this.boardElement.style.position = 'relative';
    this.boardElement.appendChild(this.svg);
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
