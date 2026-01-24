import {
  Opening,
  detectOpening,
  getCounterOpenings,
  getNextOpeningMove,
  BLACK_VS_E4,
  BLACK_VS_D4,
} from './openings-database';

export interface OpeningState {
  selectedOpening: Opening | null;      // User's selected opening
  detectedOpening: Opening | null;      // Detected opponent opening
  suggestedMove: string | null;         // Next move to play for selected opening
  counterOpenings: Opening[] | null;    // Available counters to opponent opening
  moveHistory: string[];                // UCI moves played
  awaitingCounterChoice: boolean;       // Show counter-opening prompt?
  lastDetectedOpening: string | null;   // To detect changes
}

type OpeningCallback = (state: OpeningState) => void;

export class OpeningTracker {
  private state: OpeningState = {
    selectedOpening: null,
    detectedOpening: null,
    suggestedMove: null,
    counterOpenings: null,
    moveHistory: [],
    awaitingCounterChoice: false,
    lastDetectedOpening: null,
  };

  private callbacks: OpeningCallback[] = [];
  private playerColor: 'white' | 'black' = 'white';

  setPlayerColor(color: 'white' | 'black') {
    this.playerColor = color;
  }

  // Select an opening to follow
  selectOpening(opening: Opening) {
    this.state.selectedOpening = opening;
    this.updateSuggestedMove();
    this.notifyCallbacks();
  }

  // Clear selected opening
  clearOpening() {
    this.state.selectedOpening = null;
    this.state.suggestedMove = null;
    this.notifyCallbacks();
  }

  // Select a counter-opening
  selectCounterOpening(counter: Opening) {
    this.state.selectedOpening = counter;
    this.state.awaitingCounterChoice = false;
    this.state.counterOpenings = null;
    this.updateSuggestedMove();
    this.notifyCallbacks();
  }

  // Decline counter-opening suggestion
  declineCounter() {
    this.state.awaitingCounterChoice = false;
    this.state.counterOpenings = null;
    this.notifyCallbacks();
  }

  // Called when a move is played on the board
  onMove(move: string) {
    this.state.moveHistory.push(move);

    // Detect opponent's opening
    const detected = detectOpening(this.state.moveHistory);

    if (detected) {
      // Check if opponent's opening changed
      const openingChanged = detected.name !== this.state.lastDetectedOpening;

      if (openingChanged) {
        this.state.detectedOpening = detected;
        this.state.lastDetectedOpening = detected.name;

        // If we're white and opponent played something new, suggest counters
        if (this.playerColor === 'white' && this.state.moveHistory.length >= 2) {
          const counters = getCounterOpenings(detected);
          if (counters.length > 0 && !this.state.selectedOpening) {
            this.state.counterOpenings = counters;
            this.state.awaitingCounterChoice = true;
          }
        }
      }
    }

    // Update suggested move for selected opening
    this.updateSuggestedMove();
    this.notifyCallbacks();
  }

  // Reset for new game
  reset() {
    this.state = {
      selectedOpening: null,
      detectedOpening: null,
      suggestedMove: null,
      counterOpenings: null,
      moveHistory: [],
      awaitingCounterChoice: false,
      lastDetectedOpening: null,
    };
    this.notifyCallbacks();
  }

  // Check if we're still in opening phase (first ~10 moves)
  isInOpeningPhase(): boolean {
    return this.state.moveHistory.length < 20; // 10 moves per side
  }

  // Get next suggested move based on selected opening
  private updateSuggestedMove() {
    if (!this.state.selectedOpening) {
      this.state.suggestedMove = null;
      return;
    }

    const nextMove = getNextOpeningMove(this.state.selectedOpening, this.state.moveHistory);
    this.state.suggestedMove = nextMove;
  }

  // Subscribe to state changes
  onChange(callback: OpeningCallback) {
    this.callbacks.push(callback);
  }

  private notifyCallbacks() {
    const stateCopy = { ...this.state };
    this.callbacks.forEach(cb => cb(stateCopy));
  }

  getState(): OpeningState {
    return { ...this.state };
  }

  // Get appropriate openings based on player color and current position
  getAvailableOpenings(): Opening[] {
    if (this.state.moveHistory.length === 0) {
      // Game hasn't started
      if (this.playerColor === 'white') {
        // Return e4 openings as default
        return [];
      }
    }

    // Check what white played
    const firstMove = this.state.moveHistory[0];
    if (!firstMove) return [];

    if (this.playerColor === 'black') {
      if (firstMove === 'e2e4') {
        return BLACK_VS_E4;
      } else if (firstMove === 'd2d4') {
        return BLACK_VS_D4;
      }
    }

    return [];
  }
}
