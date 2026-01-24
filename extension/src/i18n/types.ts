export interface Translations {
  // App
  app: {
    name: string;
  };

  // Player color
  player: {
    title: string;
    white: string;
    black: string;
    switch: string;
    redetect: string;
  };

  // Analysis
  analysis: {
    eval: string;
    centipawns: string;
    move: string;
    mateIn: string;
    depth: string;
  };

  // ELO
  elo: {
    title: string;
    display: string;
    antiCheat: string;
  };

  // Play modes
  modes: {
    title: string;
    safe: {
      label: string;
      description: string;
    };
    balanced: {
      label: string;
      description: string;
    };
    blitz: {
      label: string;
      description: string;
    };
    positional: {
      label: string;
      description: string;
    };
    aggressive: {
      label: string;
      description: string;
    };
    tactical: {
      label: string;
      description: string;
    };
  };

  // Engine settings
  engine: {
    title: string;
    searchMode: string;
    depth: string;
    timePerMove: string;
    analysisLines: string;
  };

  // Display settings
  display: {
    title: string;
    showArrows: string;
    showEvalBar: string;
    blunderThreshold: string;
    useMultipleArrowColors: string;
    bestMove: string;
    secondMove: string;
    otherMoves: string;
    singleArrowColor: string;
  };

  // Openings
  openings: {
    title: string;
    nextMove: string;
    completed: string;
    detected: string;
    waitingForWhite: string;
    noOpening: string;
  };

  // Settings modal
  settings: {
    title: string;
    language: string;
    automatic: string;
    french: string;
    english: string;
    detected: string;
  };

  // Version check
  version: {
    title: string;
    message: string;
    current: string;
    required: string;
    download: string;
  };
}

export type Language = 'fr' | 'en';
