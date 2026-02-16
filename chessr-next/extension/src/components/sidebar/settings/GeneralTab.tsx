import { useSettingsStore } from '../../../stores/settingsStore';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';

export function GeneralTab() {
  const {
    language,
    showGameStatistics,
    showDetailedMoveSuggestion,
    showEvalBar,
    setLanguage,
    setShowGameStatistics,
    setShowDetailedMoveSuggestion,
    setShowEvalBar,
  } = useSettingsStore();

  return (
    <div className="tw-space-y-6">
      {/* Language Section */}
      <div className="tw-space-y-2">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Language</Label>
        <Select value={language} onValueChange={setLanguage} disabled>
          <SelectTrigger className="tw-w-full">
            <SelectValue placeholder="Select language" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
        <p className="tw-text-xs tw-text-muted-foreground">
          More languages coming soon
        </p>
      </div>

      {/* Display Options */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Display Options</Label>

        {/* Show Game Statistics */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">Show game statistics</Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              Accuracy and move classification card
            </p>
          </div>
          <Switch
            checked={showGameStatistics}
            onCheckedChange={setShowGameStatistics}
          />
        </div>

        {/* Show Detailed Move Suggestion */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">Show detailed move suggestion</Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              Move quality and effects card
            </p>
          </div>
          <Switch
            checked={showDetailedMoveSuggestion}
            onCheckedChange={setShowDetailedMoveSuggestion}
          />
        </div>

        {/* Show Eval Bar */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">Show Eval bar</Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              Chess board eval bar
            </p>
          </div>
          <Switch
            checked={showEvalBar}
            onCheckedChange={setShowEvalBar}
          />
        </div>
      </div>
    </div>
  );
}
