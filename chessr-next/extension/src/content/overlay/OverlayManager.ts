/**
 * OverlayManager - Manages the SVG overlay on the chess board
 * Handles creation, positioning, and resizing of the overlay
 */

export class OverlayManager {
  private svg: SVGSVGElement | null = null;
  private boardElement: HTMLElement | null = null;
  private isFlipped = false;
  private squareSize = 0;
  private resizeObserver: ResizeObserver | null = null;
  private resizeCallbacks: Set<() => void> = new Set();

  /**
   * Initialize the overlay on a board element
   */
  initialize(boardElement: HTMLElement, isFlipped: boolean): void {
    this.boardElement = boardElement;
    this.isFlipped = isFlipped;
    this.createSVG();
    this.setupResizeObserver();
  }

  /**
   * Create the SVG overlay element
   */
  private createSVG(): void {
    if (!this.boardElement) return;

    // Remove existing overlay
    this.svg?.remove();
    document.querySelector('.chessr-overlay')?.remove();

    // Calculate square size from board
    const boardRect = this.boardElement.getBoundingClientRect();
    this.squareSize = boardRect.width / 8;

    if (this.squareSize === 0) return;

    const boardWidth = this.squareSize * 8;
    const boardHeight = this.squareSize * 8;

    // Create SVG
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'chessr-overlay');
    this.svg.setAttribute('width', boardWidth.toString());
    this.svg.setAttribute('height', boardHeight.toString());
    this.svg.setAttribute('viewBox', `0 0 ${boardWidth} ${boardHeight}`);
    this.svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: ${boardWidth}px;
      height: ${boardHeight}px;
      pointer-events: none;
      z-index: 100;
    `;

    // Add defs for arrow markers
    this.svg.innerHTML = `
      <defs></defs>
      <g id="arrows"></g>
    `;

    // Ensure board has position relative
    const computedStyle = window.getComputedStyle(this.boardElement);
    if (computedStyle.position === 'static') {
      this.boardElement.style.position = 'relative';
    }

    this.boardElement.appendChild(this.svg);
  }

  /**
   * Setup resize observer to handle board resizing
   */
  private setupResizeObserver(): void {
    if (!this.boardElement) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.createSVG();
      // Notify listeners that resize happened (arrows need to be redrawn)
      this.resizeCallbacks.forEach(callback => callback());
    });
    this.resizeObserver.observe(this.boardElement);
  }

  /**
   * Register a callback for resize events
   */
  onResize(callback: () => void): void {
    this.resizeCallbacks.add(callback);
  }

  /**
   * Unregister a resize callback
   */
  offResize(callback: () => void): void {
    this.resizeCallbacks.delete(callback);
  }

  /**
   * Get the center position of a square
   */
  getSquareCenter(square: string): { x: number; y: number } {
    const file = square.charCodeAt(0) - 97; // a=0, h=7
    const rank = parseInt(square[1]) - 1; // 1=0, 8=7

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

  /**
   * Get the square size
   */
  getSquareSize(): number {
    return this.squareSize;
  }

  /**
   * Get the SVG element
   */
  getSVG(): SVGSVGElement | null {
    return this.svg;
  }

  /**
   * Get the arrows layer
   */
  getArrowsLayer(): SVGGElement | null {
    return this.svg?.querySelector('#arrows') || null;
  }

  /**
   * Clear all arrows
   */
  clearArrows(): void {
    const layer = this.getArrowsLayer();
    if (layer) layer.innerHTML = '';

    // Also clear custom markers
    const defs = this.svg?.querySelector('defs');
    if (defs) defs.innerHTML = '';
  }

  /**
   * Set board orientation
   */
  setFlipped(isFlipped: boolean): void {
    if (this.isFlipped !== isFlipped) {
      this.isFlipped = isFlipped;
      this.createSVG();
    }
  }

  /**
   * Destroy the overlay
   */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeCallbacks.clear();
    this.svg?.remove();
    this.svg = null;
    this.boardElement = null;
  }
}

// Singleton instance
export const overlayManager = new OverlayManager();
