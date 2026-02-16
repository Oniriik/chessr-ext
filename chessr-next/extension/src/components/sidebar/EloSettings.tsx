import { Card, CardContent } from '../ui/card';
import { Slider } from '../ui/slider';
import { Checkbox } from '../ui/checkbox';
import { useEngineStore, getRiskLabel } from '../../stores/engineStore';

export function EloSettings() {
  const {
    userElo,
    targetEloAuto,
    targetEloManual,
    riskTaking,
    getTargetElo,
    setTargetEloAuto,
    setTargetEloManual,
    setRiskTaking,
  } = useEngineStore();

  const targetElo = getTargetElo();

  return (
    <Card className="tw-bg-muted/50">
      <CardContent className="tw-p-4 tw-space-y-5">
        {/* Target ELO */}
        <div className="tw-space-y-3">
          <p className="tw-text-sm tw-font-medium">Target ELO</p>
          <div className="tw-flex tw-items-center tw-justify-between">
            <label className="tw-flex tw-items-center tw-gap-2 tw-cursor-pointer">
              <Checkbox
                checked={targetEloAuto}
                onCheckedChange={(checked) => setTargetEloAuto(checked === true)}
              />
              <span className="tw-text-xs tw-text-muted-foreground">
                {targetEloAuto ? `${userElo} + 150` : 'Auto'}
              </span>
            </label>
            <span className="tw-text-xl tw-font-bold tw-text-primary">
              {targetElo}
            </span>
          </div>
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

        {/* Risk Taking */}
        <div className="tw-space-y-3">
          <div>
            <p className="tw-text-sm tw-font-medium">Risk Taking</p>
            <p className="tw-text-xs tw-text-muted-foreground">How much risk to accept for winning chances</p>
          </div>
          <div className="tw-flex tw-items-center tw-justify-between">
            <span className="tw-text-xs tw-text-muted-foreground">
              {riskTaking}%
            </span>
            <span className="tw-text-xl tw-font-bold tw-text-primary">
              {getRiskLabel(riskTaking)}
            </span>
          </div>
          <Slider
            value={[riskTaking]}
            onValueChange={([value]) => setRiskTaking(value)}
            min={0}
            max={100}
            step={5}
          />
        </div>
      </CardContent>
    </Card>
  );
}
