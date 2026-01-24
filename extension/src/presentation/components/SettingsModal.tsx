import { X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../store/app.store';
import { useAuthStore } from '../store/auth.store';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Switch } from './ui/switch';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { t, currentLanguage } = useTranslation();
  const { settings, setSettings: setSettingsBase } = useAppStore();
  const { user } = useAuthStore();

  // Wrapper to include userId for cloud sync
  const setSettings = (partial: Partial<typeof settings>) => {
    setSettingsBase(partial, user?.id);
  };

  if (!isOpen) return null;

  const languageOptions = [
    {
      value: 'auto',
      label: `${t.settings.automatic} (${currentLanguage === 'fr' ? t.settings.french : t.settings.english})`,
    },
    {
      value: 'fr',
      label: t.settings.french,
    },
    {
      value: 'en',
      label: t.settings.english,
    },
  ];

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[10001] tw-flex tw-items-center tw-justify-center tw-font-sans">
      {/* Overlay */}
      <div
        className="tw-absolute tw-inset-0 tw-bg-black/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="tw-relative tw-bg-background tw-rounded-lg tw-p-6 tw-w-96 tw-max-w-[90vw] tw-shadow-2xl">
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-mb-6">
          <h2 className="tw-text-xl tw-font-bold tw-text-foreground">{t.settings.title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="tw-w-5 tw-h-5" />
          </Button>
        </div>

        {/* Language Section */}
        <div className="tw-space-y-2 tw-mb-6">
          <label className="tw-text-sm tw-font-medium tw-text-foreground">
            {t.settings.language}
          </label>
          <Select
            value={settings.language}
            onValueChange={(value) => setSettings({ language: value as 'fr' | 'en' | 'auto' })}
            options={languageOptions}
          />
        </div>

        {/* Display Section */}
        <div className="tw-space-y-4">
          <h3 className="tw-text-base tw-font-semibold tw-text-foreground tw-mb-3">
            {t.display.title}
          </h3>

          <div className="tw-flex tw-items-center tw-justify-between">
            <span className="tw-text-sm tw-text-foreground">{t.display.showArrows}</span>
            <Switch
              checked={settings.showArrows}
              onCheckedChange={(checked) => setSettings({ showArrows: checked })}
            />
          </div>

          <div className="tw-flex tw-items-center tw-justify-between">
            <span className="tw-text-sm tw-text-foreground">{t.display.showEvalBar}</span>
            <Switch
              checked={settings.showEvalBar}
              onCheckedChange={(checked) => setSettings({ showEvalBar: checked })}
            />
          </div>

        </div>

        {/* Suggestions Section */}
        <div className="tw-space-y-4 tw-mt-6">
          <h3 className="tw-text-base tw-font-semibold tw-text-foreground tw-mb-3">
            {t.suggestions.title}
          </h3>

          <div className="tw-flex tw-items-center tw-justify-between">
            <span className="tw-text-sm tw-text-foreground">{t.suggestions.numberOfSuggestions}</span>
            <Select
              value={String(settings.numberOfSuggestions)}
              onValueChange={(value) => setSettings({ numberOfSuggestions: Number(value) as 1 | 2 | 3 })}
              options={[
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '3', label: '3' },
              ]}
            />
          </div>

          <div className="tw-border-t tw-border-border tw-pt-4">
            {settings.numberOfSuggestions > 1 && (
              <div className="tw-flex tw-items-center tw-justify-between tw-mb-3">
                <span className="tw-text-sm tw-text-foreground">{t.suggestions.useSameColor}</span>
                <Switch
                  checked={!settings.useDifferentArrowColors}
                  onCheckedChange={(checked) => setSettings({ useDifferentArrowColors: !checked })}
                />
              </div>
            )}

            {settings.useDifferentArrowColors && settings.numberOfSuggestions > 1 ? (
              <div className="tw-space-y-3">
                {[
                  { key: 'best', label: t.suggestions.firstSuggestion },
                  { key: 'second', label: t.suggestions.secondSuggestion },
                  { key: 'other', label: t.suggestions.thirdSuggestion },
                ].slice(0, settings.numberOfSuggestions).map(({ key, label }) => (
                  <div key={key} className="tw-flex tw-items-center tw-justify-between">
                    <span className="tw-text-sm tw-text-foreground">{label}</span>
                    <input
                      type="color"
                      value={settings.arrowColors[key as keyof typeof settings.arrowColors]}
                      onChange={(e) => setSettings({ arrowColors: { ...settings.arrowColors, [key]: e.target.value } })}
                      className="tw-w-8 tw-h-8 tw-rounded tw-cursor-pointer tw-border-0 tw-bg-transparent"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="tw-flex tw-items-center tw-justify-between">
                <span className="tw-text-sm tw-text-foreground">{t.suggestions.singleColor}</span>
                <input
                  type="color"
                  value={settings.singleArrowColor}
                  onChange={(e) => setSettings({ singleArrowColor: e.target.value })}
                  className="tw-w-8 tw-h-8 tw-rounded tw-cursor-pointer tw-border-0 tw-bg-transparent"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
