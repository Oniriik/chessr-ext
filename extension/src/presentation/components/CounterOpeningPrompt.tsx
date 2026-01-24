import { Shield, X, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useOpeningStore } from '../store/opening.store';
import { Button } from './ui/button';
import { Opening } from '../../content/openings/openings-database';

export function CounterOpeningPrompt() {
  const { openingState, callbacks } = useOpeningStore();
  const [expanded, setExpanded] = useState(false);

  const { detectedOpening, counterOpenings, awaitingCounterChoice } = openingState;

  // Don't show if not awaiting choice or no counters
  if (!awaitingCounterChoice || !counterOpenings || counterOpenings.length === 0 || !detectedOpening) {
    return null;
  }

  const handleSelectCounter = (counter: Opening) => {
    callbacks?.onSelectCounter(counter);
    setExpanded(false);
  };

  const handleDecline = () => {
    callbacks?.onDeclineCounter();
    setExpanded(false);
  };

  return (
    <div className="tw-fixed tw-bottom-4 tw-left-4 tw-z-[10001] tw-font-sans">
      <div className="tw-bg-background tw-border tw-border-primary/50 tw-rounded-lg tw-shadow-xl tw-overflow-hidden tw-max-w-xs">
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-p-3 tw-bg-primary/10 tw-border-b tw-border-primary/30">
          <div className="tw-flex tw-items-center tw-gap-2">
            <Shield className="tw-w-4 tw-h-4 tw-text-primary" />
            <span className="tw-text-sm tw-font-medium">Contre-ouverture?</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleDecline} className="tw-h-6 tw-w-6 tw-p-0">
            <X className="tw-w-4 tw-h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="tw-p-3">
          <div className="tw-text-xs tw-text-muted tw-mb-1">Ouverture détectée:</div>
          <div className="tw-text-sm tw-font-medium tw-mb-3">{detectedOpening.name}</div>

          {!expanded ? (
            <Button
              variant="default"
              size="sm"
              onClick={() => setExpanded(true)}
              className="tw-w-full"
            >
              Voir les contre-ouvertures
              <ChevronRight className="tw-w-4 tw-h-4 tw-ml-1" />
            </Button>
          ) : (
            <div className="tw-space-y-2">
              <div className="tw-text-xs tw-text-muted tw-mb-2">Choisir une contre-ouverture:</div>
              {counterOpenings.map((counter) => (
                <button
                  key={counter.name}
                  onClick={() => handleSelectCounter(counter)}
                  className="tw-w-full tw-flex tw-flex-col tw-p-2 tw-bg-card hover:tw-bg-accent tw-rounded-lg tw-transition-colors tw-text-left tw-border tw-border-border"
                >
                  <div className="tw-flex tw-items-center tw-justify-between">
                    <span className="tw-text-sm tw-font-medium">{counter.name}</span>
                    <span className="tw-text-xs tw-text-muted">{counter.eco}</span>
                  </div>
                  {counter.description && (
                    <span className="tw-text-xs tw-text-muted tw-mt-0.5">{counter.description}</span>
                  )}
                </button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDecline}
                className="tw-w-full tw-mt-2"
              >
                Non merci
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
