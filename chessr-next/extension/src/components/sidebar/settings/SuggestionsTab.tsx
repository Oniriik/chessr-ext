import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useOpeningStore } from '../../../stores/openingStore';
import { usePlatform } from '../../../contexts/PlatformContext';
import { Label } from '../../ui/label';
import { Switch } from '../../ui/switch';
import { Slider } from '../../ui/slider';

function useChesscomPremoveSetting(isChesscom: boolean) {
  const [premovesEnabled, setPremovesEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (!isChesscom) return;

    window.postMessage({ type: 'chessr:checkPremoveSetting' }, '*');

    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'chessr:premoveSettingResult') {
        setPremovesEnabled(e.data.enabled);
      }
      if (e.data?.type === 'chessr:premoveSettingUpdated') {
        setEnabling(false);
        if (e.data.success) setPremovesEnabled(true);
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [isChesscom]);

  const enable = useCallback(() => {
    setEnabling(true);
    window.postMessage({ type: 'chessr:enablePremoveSetting' }, '*');
  }, []);

  return { premovesEnabled, enabling, enable };
}

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
    <div className="tw-flex tw-items-center tw-gap-2">
      <Label className="tw-text-xs tw-text-muted-foreground">{label}</Label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tw-w-8 tw-h-8 tw-rounded-lg tw-border tw-border-border tw-cursor-pointer tw-bg-transparent tw-p-0 [&::-webkit-color-swatch-wrapper]:tw-p-0 [&::-webkit-color-swatch]:tw-rounded-[6px] [&::-webkit-color-swatch]:tw-border-none [&::-moz-color-swatch]:tw-rounded-[6px] [&::-moz-color-swatch]:tw-border-none"
      />
    </div>
  );
}

function HotkeyInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (key: string) => void;
  label: string;
}) {
  const { t } = useTranslation('settings');
  const [capturing, setCapturing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="tw-flex tw-items-center tw-gap-2">
      <Label className="tw-text-xs tw-text-muted-foreground">{label}</Label>
      <input
        ref={inputRef}
        readOnly
        value={capturing ? t('pressAKey') : value.toUpperCase()}
        onFocus={() => setCapturing(true)}
        onBlur={() => setCapturing(false)}
        onKeyDown={(e) => {
          if (!capturing) return;
          e.preventDefault();
          onChange(e.key);
          setCapturing(false);
          inputRef.current?.blur();
        }}
        className="tw-w-16 tw-h-8 tw-px-2 tw-text-center tw-text-xs tw-font-mono tw-rounded-md tw-border tw-border-input tw-bg-background tw-text-foreground tw-cursor-pointer focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-ring"
      />
    </div>
  );
}

function SuggestionBlock({
  label,
  color,
  onColorChange,
  hotkey,
  onHotkeyChange,
  showColor,
}: {
  label: string;
  color: string;
  onColorChange: (color: string) => void;
  hotkey: string;
  onHotkeyChange: (key: string) => void;
  showColor: boolean;
}) {
  const { t } = useTranslation('settings');

  return (
    <div className="tw-space-y-1.5">
      <Label className="tw-text-sm tw-font-medium">{label}</Label>
      <div className="tw-flex tw-items-center tw-gap-4">
        {showColor && (
          <ColorPicker label={t('color')} value={color} onChange={onColorChange} />
        )}
        <HotkeyInput label={t('hotkey')} value={hotkey} onChange={onHotkeyChange} />
      </div>
    </div>
  );
}

export function SuggestionsTab() {
  const { t } = useTranslation('settings');
  const {
    numberOfSuggestions,
    useSameColorForAllArrows,
    singleArrowColor,
    firstArrowColor,
    secondArrowColor,
    thirdArrowColor,
    hotkeyMoveEnabled,
    firstHotkey,
    secondHotkey,
    thirdHotkey,
    premoveHotkey,
    premoveDelayRange,
    setNumberOfSuggestions,
    setUseSameColorForAllArrows,
    setSingleArrowColor,
    setFirstArrowColor,
    setSecondArrowColor,
    setThirdArrowColor,
    setHotkeyMoveEnabled,
    setFirstHotkey,
    setSecondHotkey,
    setThirdHotkey,
    setPremoveHotkey,
    setPremoveDelayRange,
    humanizeEnabled,
    pickDelayRange,
    selectDelayRange,
    moveDelayRange,
    setHumanizeEnabled,
    setPickDelayRange,
    setSelectDelayRange,
    setMoveDelayRange,
  } = useSettingsStore();

  const { openingArrowColor, setOpeningArrowColor } = useOpeningStore();
  const { platform } = usePlatform();
  const isChesscom = platform.id === 'chesscom';
  const { premovesEnabled, enabling, enable: enablePremoves } = useChesscomPremoveSetting(isChesscom);

  const colors = [firstArrowColor, secondArrowColor, thirdArrowColor];
  const colorSetters = [setFirstArrowColor, setSecondArrowColor, setThirdArrowColor];
  const hotkeys = [firstHotkey, secondHotkey, thirdHotkey];
  const hotkeySetters = [setFirstHotkey, setSecondHotkey, setThirdHotkey];
  const labels = [t('firstSuggestion'), t('secondSuggestion'), t('thirdSuggestion')];

  return (
    <div className="tw-space-y-6">
      {/* Number of Suggestions */}
      <div className="tw-space-y-2">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          {t('numberOfSuggestions')}
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

      {/* Suggestions Section */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          {t('suggestions')}
        </Label>

        {/* Use Same Color Toggle */}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">
              {t('useSameColor')}
            </Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              {t('useSameColorDesc')}
            </p>
          </div>
          <Switch
            checked={useSameColorForAllArrows}
            onCheckedChange={setUseSameColorForAllArrows}
          />
        </div>

        {/* Single color picker when same color is on */}
        {useSameColorForAllArrows && (
          <ColorPicker
            label={t('arrowColor')}
            value={singleArrowColor}
            onChange={setSingleArrowColor}
          />
        )}

        {/* Per-suggestion blocks */}
        <div className="tw-space-y-4 tw-pt-2">
          {Array.from({ length: numberOfSuggestions }, (_, i) => (
            <SuggestionBlock
              key={i}
              label={labels[i]}
              color={colors[i]}
              onColorChange={colorSetters[i]}
              hotkey={hotkeys[i]}
              onHotkeyChange={hotkeySetters[i]}
              showColor={!useSameColorForAllArrows}
            />
          ))}
        </div>
      </div>

      {/* Hotkey Move Section */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          {t('hotkeyMove')}
        </Label>
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <div className="tw-space-y-0.5">
            <Label className="tw-text-sm tw-font-medium">
              {t('enableHotkeyMove')}
            </Label>
            <p className="tw-text-xs tw-text-muted-foreground">
              {t('enableHotkeyMoveDesc')}
            </p>
          </div>
          <Switch
            checked={hotkeyMoveEnabled}
            onCheckedChange={setHotkeyMoveEnabled}
          />
        </div>

        {hotkeyMoveEnabled && (
          <div className={`tw-space-y-4 tw-pt-2 ${!isChesscom ? 'tw-opacity-50 tw-pointer-events-none' : ''}`}>
            {!isChesscom && (
              <p className="tw-text-xs tw-text-amber-500">
                {t('premoveNotAvailable')}
              </p>
            )}

            {isChesscom && premovesEnabled === false && (
              <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-p-2.5 tw-rounded-md tw-bg-amber-500/10 tw-border tw-border-amber-500/20">
                <p className="tw-text-xs tw-text-amber-500">
                  {t('chesscomPremovesDisabled')}
                </p>
                <button
                  onClick={enablePremoves}
                  disabled={enabling}
                  className="tw-text-xs tw-font-medium tw-text-amber-500 tw-bg-amber-500/15 tw-px-2.5 tw-py-1 tw-rounded tw-border-0 tw-cursor-pointer tw-whitespace-nowrap hover:tw-bg-amber-500/25 disabled:tw-opacity-50 disabled:tw-cursor-not-allowed"
                >
                  {enabling ? t('enabling') : t('enableIt')}
                </button>
              </div>
            )}

            {/* Premove modifier key */}
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
              <div className="tw-space-y-0.5">
                <Label className="tw-text-sm tw-font-medium">
                  {t('premoveKey')}
                </Label>
                <p className="tw-text-xs tw-text-muted-foreground">
                  {t('premoveKeyDesc')}
                </p>
              </div>
              <HotkeyInput
                label=""
                value={premoveHotkey}
                onChange={setPremoveHotkey}
              />
            </div>

            {/* Premove delay range */}
            <div>
              <div className="tw-flex tw-items-center tw-justify-between tw-mb-1.5">
                <Label className="tw-text-sm tw-font-medium">{t('premoveDelay')}</Label>
                <span className="tw-text-xs tw-font-mono tw-text-muted-foreground">
                  {(premoveDelayRange[0] / 1000).toFixed(1)}s – {(premoveDelayRange[1] / 1000).toFixed(1)}s
                </span>
              </div>
              <Slider
                value={premoveDelayRange}
                onValueChange={(v) => setPremoveDelayRange(v as [number, number])}
                min={0}
                max={3000}
                step={100}
              />
            </div>
          </div>
        )}
      </div>

      {/* Humanize Section */}
      {hotkeyMoveEnabled && (
        <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
          <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
            {t('humanize')}
          </Label>

          <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
            <div className="tw-space-y-0.5">
              <Label className="tw-text-sm tw-font-medium">
                {t('humanizeMoves')}
              </Label>
              <p className="tw-text-xs tw-text-muted-foreground">
                {t('humanizeDesc')}
              </p>
            </div>
            <Switch
              checked={humanizeEnabled}
              onCheckedChange={setHumanizeEnabled}
            />
          </div>

          {!humanizeEnabled && (
            <p className="tw-text-xs tw-text-amber-500">
              {t('humanizeWarning')}
            </p>
          )}

          {humanizeEnabled && (
            <div className="tw-space-y-4 tw-pt-2">
              {/* Pick delay */}
              <div>
                <div className="tw-flex tw-items-center tw-justify-between tw-mb-1.5">
                  <div>
                    <Label className="tw-text-sm tw-font-medium">{t('pickDelay')}</Label>
                    <p className="tw-text-xs tw-text-muted-foreground">{t('pickDelayDesc')}</p>
                  </div>
                  <span className="tw-text-xs tw-font-mono tw-text-muted-foreground tw-whitespace-nowrap">
                    {pickDelayRange[0]}–{pickDelayRange[1]}ms
                  </span>
                </div>
                <Slider
                  value={pickDelayRange}
                  onValueChange={(v) => setPickDelayRange(v as [number, number])}
                  min={0}
                  max={500}
                  step={10}
                />
              </div>

              {/* Select delay */}
              <div>
                <div className="tw-flex tw-items-center tw-justify-between tw-mb-1.5">
                  <div>
                    <Label className="tw-text-sm tw-font-medium">{t('selectDelay')}</Label>
                    <p className="tw-text-xs tw-text-muted-foreground">{t('selectDelayDesc')}</p>
                  </div>
                  <span className="tw-text-xs tw-font-mono tw-text-muted-foreground tw-whitespace-nowrap">
                    {selectDelayRange[0]}–{selectDelayRange[1]}ms
                  </span>
                </div>
                <Slider
                  value={selectDelayRange}
                  onValueChange={(v) => setSelectDelayRange(v as [number, number])}
                  min={0}
                  max={300}
                  step={10}
                />
              </div>

              {/* Move delay */}
              <div>
                <div className="tw-flex tw-items-center tw-justify-between tw-mb-1.5">
                  <div>
                    <Label className="tw-text-sm tw-font-medium">{t('moveDelay')}</Label>
                    <p className="tw-text-xs tw-text-muted-foreground">{t('moveDelayDesc')}</p>
                  </div>
                  <span className="tw-text-xs tw-font-mono tw-text-muted-foreground tw-whitespace-nowrap">
                    {moveDelayRange[0]}–{moveDelayRange[1]}ms
                  </span>
                </div>
                <Slider
                  value={moveDelayRange}
                  onValueChange={(v) => setMoveDelayRange(v as [number, number])}
                  min={0}
                  max={500}
                  step={10}
                />
              </div>

              {/* Total move time */}
              <div className="tw-flex tw-items-center tw-justify-between tw-pt-2 tw-border-t tw-border-border/50">
                <Label className="tw-text-xs tw-text-muted-foreground">{t('totalMoveTime')}</Label>
                <span className="tw-text-xs tw-font-mono tw-text-foreground">
                  {((pickDelayRange[0] + selectDelayRange[0] + moveDelayRange[0]) / 1000).toFixed(2)}s – {((pickDelayRange[1] + selectDelayRange[1] + moveDelayRange[1]) / 1000).toFixed(2)}s
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Opening Arrow Color Section */}
      <div className="tw-space-y-4 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">
          {t('openingColor')}
        </Label>
        <ColorPicker
          label={t('openingArrowColor')}
          value={openingArrowColor}
          onChange={setOpeningArrowColor}
        />
      </div>
    </div>
  );
}
