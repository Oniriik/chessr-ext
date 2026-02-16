import { useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { useEloStore } from '../../stores/eloStore';

export function EloSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const {
    userElo,
    targetEloAuto,
    opponentEloAuto,
    targetEloManual,
    opponentEloManual,
    getTargetElo,
    getOpponentElo,
    setTargetEloAuto,
    setOpponentEloAuto,
    setTargetEloManual,
    setOpponentEloManual,
  } = useEloStore();

  const targetElo = getTargetElo();
  const opponentElo = getOpponentElo();

  return (
    <Card className="tw-bg-muted/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardContent className="tw-p-4 tw-cursor-pointer hover:tw-bg-muted/70 tw-transition-colors">
            <div className="tw-flex tw-items-center tw-justify-between">
              <div className="tw-flex tw-gap-8">
                <div>
                  <p className="tw-text-xs tw-text-muted-foreground tw-uppercase tw-tracking-wide">
                    Target ELO
                  </p>
                  <p className="tw-text-2xl tw-font-bold tw-text-primary">{targetElo}</p>
                </div>
                <div>
                  <p className="tw-text-xs tw-text-muted-foreground tw-uppercase tw-tracking-wide">
                    Opponent
                  </p>
                  <p className="tw-text-2xl tw-font-bold tw-text-primary">{opponentElo}</p>
                </div>
              </div>
              {isOpen ? (
                <ChevronUp className="tw-w-5 tw-h-5 tw-text-muted-foreground" />
              ) : (
                <ChevronDown className="tw-w-5 tw-h-5 tw-text-muted-foreground" />
              )}
            </div>
          </CardContent>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="tw-p-4 tw-pt-0 tw-space-y-6">
            {/* Target ELO */}
            <div className="tw-space-y-3">
              <div className="tw-flex tw-items-center tw-justify-between">
                <span className="tw-text-sm tw-font-medium">TARGET ELO</span>
                <div className="tw-flex tw-items-center tw-gap-4">
                  <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
                    <Checkbox
                      checked={targetEloAuto}
                      onCheckedChange={(checked) => setTargetEloAuto(checked === true)}
                    />
                    <span className="tw-text-sm">Auto</span>
                  </label>
                  <span className="tw-text-xl tw-font-bold tw-text-primary tw-w-16 tw-text-right">
                    {targetElo}
                  </span>
                </div>
              </div>
              {targetEloAuto && (
                <p className="tw-text-xs tw-text-muted-foreground">
                  User: {userElo} + 150
                </p>
              )}
              <Slider
                value={[targetEloAuto ? targetElo : targetEloManual]}
                onValueChange={([value]) => !targetEloAuto && setTargetEloManual(value)}
                min={400}
                max={3500}
                step={10}
                disabled={targetEloAuto}
                className={targetEloAuto ? 'tw-opacity-50' : ''}
              />
            </div>

            {/* Opponent ELO */}
            <div className="tw-space-y-3">
              <div className="tw-flex tw-items-center tw-justify-between">
                <span className="tw-text-sm tw-font-medium">OPPONENT ELO</span>
                <div className="tw-flex tw-items-center tw-gap-4">
                  <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
                    <Checkbox
                      checked={opponentEloAuto}
                      onCheckedChange={(checked) => setOpponentEloAuto(checked === true)}
                    />
                    <span className="tw-text-sm">Auto</span>
                  </label>
                  <span className="tw-text-xl tw-font-bold tw-text-primary tw-w-16 tw-text-right">
                    {opponentElo}
                  </span>
                </div>
              </div>
              <Slider
                value={[opponentEloAuto ? opponentElo : opponentEloManual]}
                onValueChange={([value]) => !opponentEloAuto && setOpponentEloManual(value)}
                min={400}
                max={3500}
                step={10}
                disabled={opponentEloAuto}
                className={opponentEloAuto ? 'tw-opacity-50' : ''}
              />
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
