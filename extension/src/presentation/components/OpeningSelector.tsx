import { BookOpen, ChevronDown, ChevronUp, X, Check } from 'lucide-react';
import { useState } from 'react';
import { useOpeningStore } from '../store/opening.store';
import { useTranslation } from '../../i18n';
import { Card, CardTitle } from './ui/card';
import { Opening } from '../../content/openings/openings-database';

export function OpeningSelector() {
  const { openingState, playerColor, callbacks, getWhiteOpenings, getBlackOpenings } = useOpeningStore();
  const { t } = useTranslation();
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const selectedOpening = openingState.selectedOpening;
  const suggestedMove = openingState.suggestedMove;
  const detectedOpening = openingState.detectedOpening;
  const firstMove = openingState.moveHistory[0] || null;

  // Get available openings based on player color
  const whiteCategories = getWhiteOpenings();
  const blackOpenings = getBlackOpenings(firstMove);

  const formatMove = (uci: string) => {
    if (!uci || uci.length < 4) return uci;
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    return `${from} → ${to}`;
  };

  const handleSelectOpening = (opening: Opening) => {
    callbacks?.onSelectOpening(opening);
  };

  const handleClearOpening = () => {
    callbacks?.onClearOpening();
  };

  return (
    <Card>
      <CardTitle className="tw-flex tw-items-center tw-gap-2">
        <BookOpen className="tw-w-4 tw-h-4" />
        {t.openings.title}
      </CardTitle>

      {/* Selected opening info */}
      {selectedOpening && (
        <div className="tw-mb-3 tw-p-2 tw-bg-primary/10 tw-rounded-lg tw-border tw-border-primary/30">
          <div className="tw-flex tw-items-center tw-justify-between tw-mb-1">
            <span className="tw-text-sm tw-font-medium tw-text-primary">{selectedOpening.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClearOpening();
              }}
              className="tw-h-6 tw-w-6 tw-p-0 tw-flex tw-items-center tw-justify-center tw-rounded tw-text-gray-400 hover:tw-text-red-400 hover:tw-bg-red-500/20 tw-transition-colors"
            >
              <X className="tw-w-4 tw-h-4" />
            </button>
          </div>
          <div className="tw-text-xs tw-text-muted">{selectedOpening.eco}</div>
          {suggestedMove && (
            <div className="tw-mt-2 tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-xs tw-text-muted">{t.openings.nextMove}:</span>
              <span className="tw-text-sm tw-font-bold tw-text-success">{formatMove(suggestedMove)}</span>
            </div>
          )}
          {!suggestedMove && openingState.moveHistory.length >= selectedOpening.moves.length && (
            <div className="tw-mt-2 tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-success">
              <Check className="tw-w-3 tw-h-3" />
              {t.openings.completed}
            </div>
          )}
        </div>
      )}

      {/* Detected opponent opening */}
      {detectedOpening && !selectedOpening && (
        <div className="tw-mb-3 tw-p-2 tw-bg-card tw-rounded-lg tw-border tw-border-gray-600">
          <div className="tw-text-xs tw-text-muted tw-mb-1">{t.openings.detected}</div>
          <div className="tw-text-sm tw-font-medium">{detectedOpening.name}</div>
          <div className="tw-text-xs tw-text-muted">{detectedOpening.eco}</div>
        </div>
      )}

      {/* Opening selector */}
      {!selectedOpening && (
        <div className="tw-space-y-2">
          {playerColor === 'white' ? (
            // White openings by category
            whiteCategories.map((category) => (
              <div key={category.name} className="tw-border tw-border-gray-700 tw-rounded-lg tw-overflow-hidden">
                <button
                  onClick={() => setExpandedCategory(expandedCategory === category.name ? null : category.name)}
                  className="tw-w-full tw-flex tw-items-center tw-justify-between tw-p-2 tw-bg-card hover:tw-bg-gray-700 tw-transition-colors"
                >
                  <span className="tw-text-sm tw-font-medium">{category.name}</span>
                  {expandedCategory === category.name ? (
                    <ChevronUp className="tw-w-4 tw-h-4" />
                  ) : (
                    <ChevronDown className="tw-w-4 tw-h-4" />
                  )}
                </button>
                {expandedCategory === category.name && (
                  <div className="tw-border-t tw-border-gray-700">
                    {category.openings.map((opening) => (
                      <OpeningItem
                        key={opening.name}
                        opening={opening}
                        onSelect={handleSelectOpening}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            // Black openings (flat list)
            blackOpenings.length > 0 ? (
              <div className="tw-border tw-border-gray-700 tw-rounded-lg tw-overflow-hidden">
                {blackOpenings.map((opening) => (
                  <OpeningItem
                    key={opening.name}
                    opening={opening}
                    onSelect={handleSelectOpening}
                  />
                ))}
              </div>
            ) : (
              <div className="tw-text-center tw-text-sm tw-text-muted tw-py-4">
                {openingState.moveHistory.length === 0
                  ? t.openings.waitingForWhite
                  : t.openings.noOpening}
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}

interface OpeningItemProps {
  opening: Opening;
  onSelect: (opening: Opening) => void;
}

function OpeningItem({ opening, onSelect }: OpeningItemProps) {
  return (
    <button
      onClick={() => onSelect(opening)}
      className="tw-w-full tw-flex tw-flex-col tw-p-2 hover:tw-bg-gray-700 tw-transition-colors tw-text-left tw-border-b tw-border-gray-700 last:tw-border-b-0"
    >
      <div className="tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-sm tw-font-medium">{opening.name}</span>
        <span className="tw-text-xs tw-text-muted">{opening.eco}</span>
      </div>
      {opening.description && (
        <span className="tw-text-xs tw-text-muted tw-mt-0.5">{opening.description}</span>
      )}
    </button>
  );
}
