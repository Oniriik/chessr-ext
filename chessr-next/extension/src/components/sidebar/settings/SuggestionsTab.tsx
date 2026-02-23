import { useSettingsStore } from '../../../stores/settingsStore';
import { useOpeningStore } from '../../../stores/openingStore';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
      <Label className="tw-text-sm tw-font-medium">{label}</Label>
      <div className="tw-relative">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="tw-w-10 tw-h-10 tw-rounded-md tw-border tw-border-border tw-cursor-pointer tw-bg-transparent"
        />
      </div>
    </div>
  );
}

export function SuggestionsTab() {
  const {
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
    setNumberOfSuggestions,
    setUseSameColorForAllArrows,
    setSingleArrowColor,
    setFirstArrowColor,
    setSecondArrowColor,
    setThirdArrowColor,
  } = useSettingsStore();

  const { openingArrowColor, setOpeningArrowColor } = useOpeningStore();

  return (
    <div className="tw-space-y-6">
      {/* Number of Suggestions */}
      <div className="tw-space-y-2">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          Number of suggestions
        </Label>
        <select
          value={numberOfSuggestions}
          onChange={(e) => setNumberOfSuggestions(Number(e.target.value) as 1 | 2 | 3)}
          className="tw-w-full tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </div>

      {/* Arrow Colors Section */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          Arrow Colors
        </Label>

        {/* Use Same Color Toggle */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">
              Use same color for all arrows
            </Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              Apply a single color to all suggestion arrows
            </p>
          </div>
          <Switch
            checked={useSameColorForAllArrows}
            onCheckedChange={setUseSameColorForAllArrows}
          />
        </div>

        {/* Color Pickers */}
        <div className="tw-space-y-3 tw-pt-2">
          {useSameColorForAllArrows ? (
            <ColorPicker
              label="Arrow color"
              value={singleArrowColor}
              onChange={setSingleArrowColor}
            />
          ) : (
            <>
              <ColorPicker
                label="1st arrow color"
                value={firstArrowColor}
                onChange={setFirstArrowColor}
              />
              {numberOfSuggestions >= 2 && (
                <ColorPicker
                  label="2nd arrow color"
                  value={secondArrowColor}
                  onChange={setSecondArrowColor}
                />
              )}
              {numberOfSuggestions >= 3 && (
                <ColorPicker
                  label="3rd arrow color"
                  value={thirdArrowColor}
                  onChange={setThirdArrowColor}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Opening Arrow Color Section */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          Opening Color
        </Label>
        <ColorPicker
          label="Opening arrow & card color"
          value={openingArrowColor}
          onChange={setOpeningArrowColor}
        />
      </div>
    </div>
  );
}
