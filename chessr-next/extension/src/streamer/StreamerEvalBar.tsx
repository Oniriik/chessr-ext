import { useSuggestionStore } from '../stores/suggestionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useEngineStore } from '../stores/engineStore';
import { useGameStore } from '../stores/gameStore';

export function StreamerEvalBar() {
  const { positionEval, mateIn, winRate, suggestedFen } = useSuggestionStore();
  const { showEvalBar, evalBarMode } = useSettingsStore();
  const { selectedEngine } = useEngineStore();
  const { isGameStarted, playerColor } = useGameStore();

  const isFlipped = playerColor === 'black';
  const effectiveMode = selectedEngine === 'maia2' ? 'winrate' as const : evalBarMode;

  if (!isGameStarted || !showEvalBar || positionEval === null || !suggestedFen) {
    return null;
  }

  // Calculate bar percentage (from white's perspective)
  let percentage: number;
  let evalStr: string;

  const displayEval = isFlipped ? -positionEval : positionEval;
  const displayMate = mateIn !== null ? (isFlipped ? -mateIn : mateIn) : null;
  const displayWinRate = isFlipped ? (100 - (winRate ?? 50)) : (winRate ?? 50);

  if (mateIn !== null) {
    percentage = mateIn > 0 ? 100 : 0;
    evalStr = displayMate! > 0 ? `M${displayMate}` : `M${Math.abs(displayMate!)}`;
  } else if (effectiveMode === 'winrate') {
    percentage = winRate ?? 50;
    evalStr = `${Math.round(displayWinRate)}%`;
  } else {
    const clampedEval = Math.max(-10, Math.min(10, positionEval));
    percentage = 50 + 50 * (2 / (1 + Math.exp(-clampedEval * 0.6)) - 1);
    evalStr = displayEval >= 0 ? `+${displayEval.toFixed(1)}` : displayEval.toFixed(1);
  }

  return (
    <div
      className="tw-relative tw-rounded tw-overflow-hidden tw-shadow-md tw-flex-shrink-0"
      style={{
        width: 28,
        height: '100%',
        background: '#2b2b2b',
      }}
    >
      {/* White bar */}
      <div
        className="tw-absolute tw-left-0 tw-w-full tw-transition-all tw-duration-300"
        style={{
          [isFlipped ? 'top' : 'bottom']: 0,
          height: `${percentage}%`,
          background: 'linear-gradient(to top, #f0f0f0, #e0e0e0)',
        }}
      />
      {/* Eval text */}
      <div
        className="tw-absolute tw-left-1/2 tw-top-1/2 tw-whitespace-nowrap tw-pointer-events-none tw-font-bold tw-text-white"
        style={{
          transform: 'translate(-50%, -50%) rotate(-90deg)',
          fontSize: 11,
          textShadow: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
        }}
      >
        {evalStr}
      </div>
    </div>
  );
}
