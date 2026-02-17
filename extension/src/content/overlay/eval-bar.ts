import type { EvalBarMode } from '../../shared/types';

export class EvalBar {
  private container: HTMLDivElement | null = null;
  private fill: HTMLDivElement | null = null;
  private text: HTMLSpanElement | null = null;
  private isFlipped = false;

  initialize(boardElement: HTMLElement) {
    this.createBar(boardElement);
  }

  setFlipped(flipped: boolean) {
    this.isFlipped = flipped;
    this.updateColors();
  }

  private updateColors() {
    if (!this.container || !this.fill) return;

    // When playing as White: white at bottom (fill), black at top (background)
    // When playing as Black: black at bottom (fill), white at top (background)
    if (this.isFlipped) {
      // Black player: black fill at bottom, white background at top
      this.container.style.background = '#f0f0f0';
      this.fill.style.background = '#333';
    } else {
      // White player: white fill at bottom, black background at top
      this.container.style.background = '#333';
      this.fill.style.background = '#f0f0f0';
    }
  }

  private createBar(boardElement: HTMLElement) {
    const parent = boardElement.parentElement || boardElement;

    // Container
    this.container = document.createElement('div');
    this.container.className = 'chessr-eval-bar';
    this.container.style.cssText = `
      position: absolute;
      left: -28px;
      top: 0;
      width: 22px;
      height: 100%;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    // Background color set dynamically based on player color

    // Fill (player's portion - grows from bottom)
    this.fill = document.createElement('div');
    this.fill.className = 'eval-bar-fill';
    this.fill.style.cssText = `
      position: absolute;
      bottom: 0;
      width: 100%;
      height: 50%;
      transition: height 0.3s ease;
    `;
    // Fill color set dynamically based on player color

    // Text
    this.text = document.createElement('span');
    this.text.className = 'eval-bar-text';
    this.text.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-90deg);
      font-size: 10px;
      font-weight: bold;
      color: #888;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;

    this.container.appendChild(this.fill);
    this.container.appendChild(this.text);

    parent.style.position = 'relative';
    parent.appendChild(this.container);

    // Set initial colors based on player
    this.updateColors();
  }

  /**
   * Update the eval bar display.
   * @param evaluation - Evaluation in pawns (from White's perspective)
   * @param mate - Mate-in value (positive = White mates, negative = Black mates)
   * @param mode - Display mode: 'eval' for pawns, 'winrate' for percentage
   * @param winRate - Win rate percentage (0-100, from White's perspective)
   */
  update(
    evaluation: number,
    mate?: number,
    mode: EvalBarMode = 'eval',
    winRate: number = 50
  ) {
    if (!this.fill || !this.text) return;

    // Flip values based on player perspective
    const displayEval = this.isFlipped ? -evaluation : evaluation;
    const displayMate = mate !== undefined ? (this.isFlipped ? -mate : mate) : undefined;
    const displayWinRate = this.isFlipped ? (100 - winRate) : winRate;

    let displayText: string;
    let whitePercentage: number;

    if (displayMate !== undefined) {
      // Mate position
      displayText = `M${Math.abs(displayMate)}`;
      whitePercentage = displayMate > 0 ? 98 : 2;
    } else if (mode === 'winrate') {
      // Win rate mode
      displayText = `${Math.round(displayWinRate)}%`;
      whitePercentage = displayWinRate;
    } else {
      // Eval mode (default)
      // Clamp evaluation to reasonable range
      const clampedEval = Math.max(-10, Math.min(10, displayEval));
      // Convert to percentage using sigmoid-like curve
      whitePercentage = 50 + 50 * (2 / (1 + Math.exp(-clampedEval * 0.6)) - 1);

      if (Math.abs(displayEval) < 0.05) {
        displayText = '0.0';
      } else {
        displayText = displayEval > 0
          ? `+${displayEval.toFixed(1)}`
          : displayEval.toFixed(1);
      }
    }

    // whitePercentage is actually "player's winning percentage" when flipped
    const playerPercentage = whitePercentage;
    this.fill.style.height = `${playerPercentage}%`;
    this.text.textContent = displayText;

    // Update text color based on what's behind it (fill or background)
    // Text is centered at 50%, so it's over the fill if playerPercentage > 50
    const textIsOverFill = playerPercentage > 50;
    if (this.isFlipped) {
      // Black player: fill is black (#333), background is white (#f0f0f0)
      this.text.style.color = textIsOverFill ? '#fff' : '#333';
    } else {
      // White player: fill is white (#f0f0f0), background is black (#333)
      this.text.style.color = textIsOverFill ? '#333' : '#fff';
    }
  }

  show() {
    if (this.container) {
      this.container.style.display = 'block';
    }
  }

  hide() {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  destroy() {
    this.container?.remove();
    this.container = null;
    this.fill = null;
    this.text = null;
  }
}
