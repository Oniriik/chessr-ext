export class EvalBar {
  private container: HTMLDivElement | null = null;
  private fill: HTMLDivElement | null = null;
  private text: HTMLSpanElement | null = null;

  initialize(boardElement: HTMLElement) {
    this.createBar(boardElement);
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
      background: #333;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;

    // Fill (white portion)
    this.fill = document.createElement('div');
    this.fill.className = 'eval-bar-fill';
    this.fill.style.cssText = `
      position: absolute;
      bottom: 0;
      width: 100%;
      height: 50%;
      background: #f0f0f0;
      transition: height 0.3s ease;
    `;

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
  }

  update(evaluation: number, mate?: number) {
    if (!this.fill || !this.text) return;

    let displayText: string;
    let whitePercentage: number;

    if (mate !== undefined) {
      displayText = `M${Math.abs(mate)}`;
      whitePercentage = mate > 0 ? 98 : 2;
    } else {
      // Clamp evaluation to reasonable range
      const clampedEval = Math.max(-10, Math.min(10, evaluation));
      // Convert to percentage using sigmoid-like curve
      whitePercentage = 50 + (clampedEval / 10) * 45;

      if (Math.abs(evaluation) < 0.1) {
        displayText = '0.0';
      } else {
        displayText = evaluation >= 0
          ? `+${evaluation.toFixed(1)}`
          : evaluation.toFixed(1);
      }
    }

    this.fill.style.height = `${whitePercentage}%`;
    this.text.textContent = displayText;

    // Update text color based on background
    this.text.style.color = whitePercentage > 50 ? '#333' : '#fff';
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
