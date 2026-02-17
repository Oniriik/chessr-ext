import { SuggestionMove } from '../../domain/analysis/feedback-types';
import { buildBadges, formatSuggestionTitle } from '../../domain/analysis/feedback-helpers';
import { useTranslation } from '../../i18n';
import { cn } from '../lib/utils';

interface SuggestionCardProps {
  suggestion: SuggestionMove;
  isSelected: boolean;
  showPromotionAsText: boolean;
  playerColor?: 'white' | 'black';
  onSelect: () => void;
}

export function SuggestionCard({
  suggestion,
  isSelected,
  showPromotionAsText,
  playerColor,
  onSelect,
}: SuggestionCardProps) {
  const { t } = useTranslation();

  // Always build and show all badges in the sidebar (independent of arrow settings)
  const badges = buildBadges(suggestion);
  const title = showPromotionAsText ? formatSuggestionTitle(suggestion) : `${suggestion.label}: ${suggestion.move}`;

  // Categorize badges for better organization
  const mainBadges = badges.filter(b =>
    b === 'Best' || b === 'Safe' || b === 'Risky' || b === 'Human' || b === 'Alt' || b.includes('Medium risk')
  );
  const tacticalBadges = badges.filter(b =>
    b.startsWith('Mate') || b === 'Check' || b.startsWith('x ') || b.includes('Promo')
  );

  // Convert score to player POV (scores are in White POV by default)
  const isBlackPlayer = playerColor === 'black';
  const scoreMultiplier = isBlackPlayer ? -1 : 1;
  const playerScore = suggestion.score.value * scoreMultiplier;

  // Format score - show resulting evaluation after playing this move
  const isBestMove = suggestion.index === 1;
  const hasDelta = suggestion.cpDelta !== undefined && suggestion.cpDelta !== 0;

  let scoreText: string;
  let scoreColor: string;

  if (suggestion.score.type === 'mate') {
    // Mate: convert to player perspective
    // score.value is in White POV: positive = White mates, negative = Black mates
    const mateValuePlayerPov = suggestion.score.value * scoreMultiplier;
    const prefix = mateValuePlayerPov > 0 ? '+' : '';
    scoreText = `${prefix}M${Math.abs(mateValuePlayerPov)}`;
    // Green if player is mating, red if opponent is mating
    scoreColor = mateValuePlayerPov > 0 ? 'tw-text-green-400' : 'tw-text-red-400';
  } else if (isBestMove) {
    // Best move: show absolute eval
    const evalPawns = playerScore / 100;
    if (Math.abs(evalPawns) < 0.05) {
      scoreText = '0.0';
      scoreColor = 'tw-text-gray-400';
    } else {
      scoreText = (evalPawns > 0 ? '+' : '') + evalPawns.toFixed(1);
      scoreColor = evalPawns > 0 ? 'tw-text-green-400' : 'tw-text-red-400';
    }
  } else if (hasDelta) {
    // Other moves: show delta vs best (cpDelta is negative for worse moves)
    const delta = suggestion.cpDelta! / 100;
    if (Math.abs(delta) < 0.05) {
      scoreText = '0.0';
      scoreColor = 'tw-text-gray-400';
    } else {
      scoreText = delta.toFixed(1); // Already negative
      scoreColor = 'tw-text-yellow-400';
    }
  } else {
    // Fallback to absolute eval
    const evalPawns = playerScore / 100;
    if (Math.abs(evalPawns) < 0.05) {
      scoreText = '0.0';
      scoreColor = 'tw-text-gray-400';
    } else {
      scoreText = (evalPawns > 0 ? '+' : '') + evalPawns.toFixed(1);
      scoreColor = evalPawns > 0 ? 'tw-text-green-400' : 'tw-text-red-400';
    }
  }

  return (
    <div
      className={cn(
        'tw-p-3 tw-rounded-md tw-border tw-cursor-pointer tw-transition-colors',
        isSelected
          ? 'tw-border-primary tw-bg-primary/10'
          : 'tw-border-border hover:tw-border-primary/50'
      )}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="tw-flex tw-items-center tw-justify-between tw-mb-2">
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-font-semibold tw-text-foreground">
            #{suggestion.index}
          </span>
          <span className="tw-text-sm tw-text-foreground">
            {title}
          </span>
        </div>
        <span className={cn(
          'tw-text-sm tw-font-mono tw-font-semibold',
          scoreColor
        )}>
          {scoreText}
        </span>
      </div>

      {/* Badges - Organized in sections - Always shown in sidebar */}
      {badges.length > 0 && (
        <div className="tw-space-y-1.5 tw-mb-2">
          {/* Quality section */}
          {mainBadges.length > 0 && (
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-text-[10px] tw-text-muted tw-uppercase tw-tracking-wide tw-min-w-[45px]">
                Quality
              </span>
              <div className="tw-flex tw-flex-wrap tw-gap-1">
                {mainBadges.map((badge, i) => (
                  <span
                    key={i}
                    className={cn(
                      'tw-text-xs tw-px-2 tw-py-0.5 tw-rounded tw-font-medium',
                      badge.includes('Best') && 'tw-bg-green-500/20 tw-text-green-400',
                      badge.includes('Safe') && 'tw-bg-blue-500/20 tw-text-blue-400',
                      badge.includes('Risky') && 'tw-bg-red-500/20 tw-text-red-400',
                      badge.includes('Human') && 'tw-bg-purple-500/20 tw-text-purple-400',
                      badge.includes('Alt') && 'tw-bg-gray-500/20 tw-text-gray-400',
                      badge.includes('Medium risk') && 'tw-bg-orange-500/20 tw-text-orange-400'
                    )}
                  >
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tactical section */}
          {tacticalBadges.length > 0 && (
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-text-[10px] tw-text-muted tw-uppercase tw-tracking-wide tw-min-w-[45px]">
                Effects
              </span>
              <div className="tw-flex tw-flex-wrap tw-gap-1">
                {tacticalBadges.map((badge, i) => {
                  const isCaptureBadge = badge.startsWith('x ');
                  const captureColorClass = isCaptureBadge
                    ? (playerColor === 'white'
                        ? 'tw-bg-gray-900 tw-text-white'
                        : 'tw-bg-gray-100 tw-text-black'
                      )
                    : '';

                  return (
                    <span
                      key={i}
                      className={cn(
                        'tw-text-xs tw-px-2 tw-py-0.5 tw-rounded tw-font-medium',
                        isCaptureBadge && captureColorClass,
                        !isCaptureBadge && badge.includes('Mate') && 'tw-bg-orange-500/20 tw-text-orange-400',
                        !isCaptureBadge && badge.includes('Check') && 'tw-bg-yellow-500/20 tw-text-yellow-400',
                        !isCaptureBadge && badge.includes('Promo') && 'tw-bg-indigo-500/20 tw-text-indigo-400'
                      )}
                    >
                      {badge}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
