/**
 * EvalBar - Displays position evaluation as a vertical bar
 * Similar to Lichess eval bar on the side of the board
 */

export class EvalBar {
  private container: HTMLDivElement | null = null;
  private whiteBar: HTMLDivElement | null = null;
  private evalText: HTMLDivElement | null = null;
  private boardElement: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isFlipped = false; // True when playing as black

  /**
   * Initialize the eval bar next to a board element
   */
  initialize(boardElement: HTMLElement): void {
    this.boardElement = boardElement;
    this.createBar();
    this.setupResizeObserver();
  }

  /**
   * Create the eval bar DOM elements
   */
  private createBar(): void {
    if (!this.boardElement) return;

    // Remove existing bar
    this.container?.remove();
    document.querySelector('.chessr-eval-bar')?.remove();

    const boardRect = this.boardElement.getBoundingClientRect();
    const barWidth = 24;
    const barHeight = boardRect.height;

    // Create container
    this.container = document.createElement('div');
    this.container.className = 'chessr-eval-bar';
    this.container.style.cssText = `
      position: absolute;
      left: -${barWidth + 6}px;
      top: 0;
      width: ${barWidth}px;
      height: ${barHeight}px;
      background: #2b2b2b;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      z-index: 100;
    `;

    // White bar (position depends on flipped state)
    this.whiteBar = document.createElement('div');
    this.whiteBar.style.cssText = `
      position: absolute;
      ${this.isFlipped ? 'top: 0;' : 'bottom: 0;'}
      left: 0;
      width: 100%;
      height: 50%;
      background: linear-gradient(${this.isFlipped ? 'to bottom' : 'to top'}, #f0f0f0, #e0e0e0);
      transition: height 0.3s ease-out;
    `;

    // Eval text overlay
    this.evalText = document.createElement('div');
    this.evalText.style.cssText = `
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%) rotate(-90deg);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: #fff;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
      white-space: nowrap;
      pointer-events: none;
    `;
    this.evalText.textContent = '0.0';

    this.container.appendChild(this.whiteBar);
    this.container.appendChild(this.evalText);

    // Ensure board parent has position relative
    const boardParent = this.boardElement.parentElement;
    if (boardParent) {
      const computedStyle = window.getComputedStyle(boardParent);
      if (computedStyle.position === 'static') {
        boardParent.style.position = 'relative';
      }
    }

    // Insert before the board
    this.boardElement.parentElement?.insertBefore(this.container, this.boardElement);
  }

  /**
   * Setup resize observer to handle board resizing
   */
  private setupResizeObserver(): void {
    if (!this.boardElement) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.createBar();
    });
    this.resizeObserver.observe(this.boardElement);
  }

  /**
   * Update the eval bar with a new evaluation
   * @param evalPawns - Evaluation in pawns (positive = white advantage, always from white's perspective)
   * @param mateIn - Mate in N moves (positive = white mates, always from white's perspective)
   * @param mode - Display mode: 'eval' for evaluation, 'winrate' for win rate percentage
   * @param winRate - Win rate percentage (0-100, from white's perspective)
   */
  update(
    evalPawns: number,
    mateIn: number | null = null,
    mode: 'eval' | 'winrate' = 'eval',
    winRate: number = 50
  ): void {
    if (!this.whiteBar || !this.evalText) return;

    let percentage: number;
    let evalStr: string;

    // Display eval from player's perspective (flip if playing black)
    const displayEval = this.isFlipped ? -evalPawns : evalPawns;
    const displayMate = mateIn !== null ? (this.isFlipped ? -mateIn : mateIn) : null;
    const displayWinRate = this.isFlipped ? (100 - winRate) : winRate;

    if (mateIn !== null) {
      // Mate position - bar goes to extreme based on who's mating
      percentage = mateIn > 0 ? 100 : 0;
      // Text shows mate from player's perspective
      evalStr = displayMate! > 0 ? `M${displayMate}` : `M${Math.abs(displayMate!)}`;
    } else if (mode === 'winrate') {
      // Win rate mode - use win rate directly as percentage
      percentage = winRate;
      // Text shows win rate from player's perspective
      evalStr = `${Math.round(displayWinRate)}%`;
    } else {
      // Regular eval mode
      // Clamp eval to reasonable range for display
      const clampedEval = Math.max(-10, Math.min(10, evalPawns));

      // Convert eval to percentage (sigmoid-like scaling)
      // At +/-2 pawns, bar is ~73% white/black
      // At +/-4 pawns, bar is ~88% white/black
      percentage = 50 + 50 * (2 / (1 + Math.exp(-clampedEval * 0.6)) - 1);

      // Text shows eval from player's perspective
      evalStr = displayEval >= 0 ? `+${displayEval.toFixed(1)}` : displayEval.toFixed(1);
    }

    this.whiteBar.style.height = `${percentage}%`;
    this.evalText.textContent = evalStr;
  }

  /**
   * Show the eval bar
   */
  show(): void {
    if (this.container) {
      this.container.style.display = 'block';
    }
  }

  /**
   * Hide the eval bar
   */
  hide(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  /**
   * Set flipped state (for playing as black)
   * When flipped, white bar is at the top instead of bottom
   */
  setFlipped(flipped: boolean): void {
    if (this.isFlipped !== flipped) {
      this.isFlipped = flipped;
      this.createBar(); // Recreate bar with new orientation
    }
  }

  /**
   * Destroy the eval bar
   */
  destroy(): void {
    this.resizeObserver?.disconnect();
    this.container?.remove();
    this.container = null;
    this.whiteBar = null;
    this.evalText = null;
    this.boardElement = null;
  }
}
