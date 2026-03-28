import { useTranslation } from 'react-i18next';
import { useSettingsStore, type EvalBarMode } from '../../../stores/settingsStore';
import { useEngineStore, type SelectedEngine } from '../../../stores/engineStore';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Slider } from '../../ui/slider';
import { Button } from '../../ui/button';
import { Monitor } from 'lucide-react';
import { SUPPORTED_LANGUAGES } from '../../../i18n/i18n';

export function GeneralTab() {
  const { t } = useTranslation('settings');
  const {
    language,
    showDetailedMoveSuggestion,
    showEvalBar,
    evalBarMode,
    showTitle,
    titleType,
    anonNames,
    anonUrl,
    setLanguage,
    setShowDetailedMoveSuggestion,
    setShowEvalBar,
    setEvalBarMode,
    setShowTitle,
    setTitleType,
    setAnonNames,
    setAnonUrl,
  } = useSettingsStore();
  const { autoEloBoost, setAutoEloBoost, selectedEngine, setSelectedEngine } = useEngineStore();

  return (
    <div className="tw-space-y-6">
      {/* Language Section */}
      <div className="tw-space-y-2">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('language')}</Label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="tw-w-full tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>{lang.label}</option>
          ))}
        </select>
      </div>

      {/* Display Options */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('displayOptions')}</Label>

        {/* Show Move Labels on Board */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">{t('showMoveLabels')}</Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              {t('showMoveLabelsDesc')}
            </p>
          </div>
          <Switch
            checked={showDetailedMoveSuggestion}
            onCheckedChange={setShowDetailedMoveSuggestion}
          />
        </div>

        {/* Anonymous Section */}
        <div className="tw-space-y-3">
          <Label className="tw-text-sm tw-font-medium">{t('anonymous')}</Label>

          <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
            <div className="tw-space-y-0.5">
              <Label className="tw-text-xs tw-font-medium">{t('anonNames')}</Label>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('anonNamesDesc')}
              </p>
            </div>
            <Switch
              checked={anonNames}
              onCheckedChange={setAnonNames}
            />
          </div>

          <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
            <div className="tw-space-y-0.5">
              <Label className="tw-text-xs tw-font-medium">{t('anonUrl')}</Label>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('anonUrlDesc')}
              </p>
            </div>
            <Switch
              checked={anonUrl}
              onCheckedChange={setAnonUrl}
            />
          </div>
        </div>

        {/* Show Eval Bar */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">{t('showEvalBar')}</Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              {t('showEvalBarDesc')}
            </p>
          </div>
          <div className="tw-flex tw-items-center tw-gap-2">
            {showEvalBar && (
              <select
                value={evalBarMode}
                onChange={(e) => setEvalBarMode(e.target.value as EvalBarMode)}
                className="tw-h-8 tw-px-2 tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-xs"
              >
                <option value="eval">{t('eval')}</option>
                <option value="winrate">{t('winPercent')}</option>
              </select>
            )}
            <Switch
              checked={showEvalBar}
              onCheckedChange={setShowEvalBar}
            />
          </div>
        </div>

        {/* Show Title */}
        <div className="tw-space-y-2">
          <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
            <div className="tw-space-y-0.5">
              <Label className="tw-text-sm tw-font-medium">{t('showTitle')}</Label>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('showTitleDesc')}
              </p>
            </div>
            <Switch
              checked={showTitle}
              onCheckedChange={setShowTitle}
            />
          </div>
          {showTitle && (
            <select
              value={titleType}
              onChange={(e) => setTitleType(e.target.value)}
              className="tw-w-full tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
            >
              <option value="GM">Grandmaster (GM)</option>
              <option value="IM">International Master (IM)</option>
              <option value="FM">FIDE Master (FM)</option>
              <option value="NM">National Master (NM)</option>
              <option value="CM">FIDE Candidate Master (CM)</option>
              <option value="WGM">Woman Grandmaster (WGM)</option>
              <option value="WIM">Woman International Master (WIM)</option>
              <option value="WFM">Woman FIDE Master (WFM)</option>
              <option value="WCM">FIDE Woman Candidate Master (WCM)</option>
              <option value="WNM">Woman National Master (WNM)</option>
            </select>
          )}
        </div>
      </div>

      {/* Engine Section */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('engine')}</Label>

        {/* Engine Selection */}
        <div className="tw-space-y-2">
          <Label className="tw-text-sm tw-font-medium">{t('engine')}</Label>
          <select
            value={selectedEngine}
            onChange={(e) => setSelectedEngine(e.target.value as SelectedEngine)}
            className="tw-w-full tw-h-9 tw-px-3 tw-py-1 tw-text-sm tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-shadow-sm focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring tw-cursor-pointer tw-appearance-none tw-bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m2%204%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] tw-bg-[length:12px] tw-bg-[right_8px_center] tw-bg-no-repeat tw-pr-8"
          >
            <option value="default">{t('defaultKomodo')}</option>
            <option value="maia2">{t('maia2Local')}</option>
          </select>
          <p className="tw-text-xs tw-text-muted-foreground">
            {selectedEngine === 'maia2'
              ? t('maia2Desc')
              : t('komodoDesc')}
          </p>
        </div>

        {/* Auto ELO Boost (shared by both engines) */}
        <div className="tw-space-y-2">
          <div className="tw-flex tw-items-center tw-justify-between">
            <Label className="tw-text-sm tw-font-medium">{t('autoEloBoost')}</Label>
            <span className="tw-text-base tw-font-bold tw-text-primary">+{autoEloBoost}</span>
          </div>
          <Slider
            value={[autoEloBoost]}
            onValueChange={([value]) => setAutoEloBoost(value)}
            min={0}
            max={300}
            step={10}
          />
          <p className="tw-text-xs tw-text-muted-foreground">
            {t('autoEloBoostDesc')}
          </p>
        </div>
      </div>

      {/* Streamer Mode */}
      <div className="tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Streamer Mode</Label>
        <div className="tw-mt-2">
          <Button
            variant="outline"
            className="tw-w-full tw-justify-start tw-gap-2"
            onClick={() => {
              window.open(chrome.runtime.getURL('streamer.html'), '_blank');
            }}
          >
            <Monitor className="tw-h-4 tw-w-4" />
            Open Streamer Mode
          </Button>
          <p className="tw-text-xs tw-text-muted-foreground tw-mt-1.5">
            Opens a separate window with the board and sidebar for OBS capture. Hides Chessr UI on the chess site.
          </p>
        </div>
      </div>
    </div>
  );
}
