import { SuggestionMove } from '../../domain/analysis/feedback-types';
import { buildBadges, formatSuggestionTitle } from '../../domain/analysis/feedback-helpers';
import { useTranslation } from '../../i18n';
import { cn } from '../lib/utils';

interface SuggestionCardProps {
  suggestion: SuggestionMove;
  isSelected: boolean;
  isExpanded: boolean;
  showPromotionAsText: boolean;
  playerColor?: 'white' | 'black';
  onSelect: () => void;
  onToggleExpand: () => void;
}

export function SuggestionCard({
  suggestion,
  isSelected,
  isExpanded,
  showPromotionAsText,
  playerColor,
  onSelect,
  onToggleExpand,
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
    b.startsWith('#') || b.startsWith('+') || b.startsWith('x ') || b.includes('Promo')
  );

  // Convert score to player POV (scores are in White POV by default)
  const isBlackPlayer = playerColor === 'black';
  const scoreMultiplier = isBlackPlayer ? -1 : 1;
  const playerScore = suggestion.score.value * scoreMultiplier;

  // Format score
  const scoreText = suggestion.score.type === 'mate'
    ? `M${Math.abs(suggestion.score.value)}`
    : (playerScore >= 0 ? '+' : '') + (playerScore / 100).toFixed(1);

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
          playerScore >= 0 ? 'tw-text-green-400' : 'tw-text-red-400'
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

      {/* PV (if expanded) */}
      {isExpanded && suggestion.pv.length > 0 && (
        <div className="tw-mt-2 tw-pt-2 tw-border-t tw-border-border">
          <div className="tw-text-xs tw-text-muted tw-mb-1">Principal Variation:</div>
          <div className="tw-text-xs tw-font-mono tw-text-foreground tw-break-all">
            {suggestion.pv.slice(0, 10).join(' ')}
          </div>
        </div>
      )}

      {/* Expand toggle */}
      {suggestion.pv.length > 0 && (
        <button
          className="tw-text-xs tw-text-primary hover:tw-underline tw-mt-2"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? 'Show less' : 'Show line'}
        </button>
      )}
    </div>
  );
}
