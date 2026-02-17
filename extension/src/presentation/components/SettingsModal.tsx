import { X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../store/app.store';
import { useAuthStore } from '../store/auth.store';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Select } from './ui/select';
import { Switch } from './ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';

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

  const languageLabels: Record<string, string> = {
    fr: t.settings.french,
    en: t.settings.english,
    es: t.settings.spanish,
    ru: t.settings.russian,
    de: t.settings.german,
    pt: t.settings.portuguese,
    hi: t.settings.hindi,
  };

  const languageOptions = [
    {
      value: 'auto',
      label: `${t.settings.automatic} (${languageLabels[currentLanguage] || t.settings.english})`,
    },
    {
      value: 'en',
      label: t.settings.english,
    },
    {
      value: 'fr',
      label: t.settings.french,
    },
    {
      value: 'es',
      label: t.settings.spanish,
    },
    {
      value: 'de',
      label: t.settings.german,
    },
    {
      value: 'pt',
      label: t.settings.portuguese,
    },
    {
      value: 'ru',
      label: t.settings.russian,
    },
    {
      value: 'hi',
      label: t.settings.hindi,
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
      <div className="tw-relative tw-bg-background tw-rounded-lg tw-p-6 tw-w-[500px] tw-max-w-[90vw] tw-max-h-[80vh] tw-shadow-2xl tw-overflow-hidden tw-flex tw-flex-col">
        {/* Header */}
        <div className="tw-flex tw-items-center tw-justify-between tw-mb-4">
          <h2 className="tw-text-xl tw-font-bold tw-text-foreground">{t.settings.title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="tw-w-5 tw-h-5" />
          </Button>
        </div>

        {/* Tabs Navigation */}
        <Tabs defaultValue="general" className="tw-flex-1 tw-overflow-hidden tw-flex tw-flex-col">
          <TabsList className="tw-mb-4">
            <TabsTrigger value="general">{t.tabs.general}</TabsTrigger>
            <TabsTrigger value="display">{t.tabs.display}</TabsTrigger>
            <TabsTrigger value="suggestions">{t.tabs.suggestions}</TabsTrigger>
            <TabsTrigger value="feedback">{t.tabs.feedback}</TabsTrigger>
          </TabsList>

          {/* Scrollable content area */}
          <div className="tw-flex-1 tw-overflow-y-auto tw-pr-2">
            {/* General Tab */}
            <TabsContent value="general">
              <div className="tw-space-y-4">
                <div className="tw-space-y-2">
                  <label className="tw-text-sm tw-font-medium tw-text-foreground">
                    {t.settings.language}
                  </label>
                  <Select
                    value={settings.language}
                    onValueChange={(value) => setSettings({ language: value as 'fr' | 'en' | 'es' | 'ru' | 'de' | 'pt' | 'hi' | 'auto' })}
                    options={languageOptions}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Display Tab */}
            <TabsContent value="display">
              <div className="tw-space-y-4">
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

                {settings.showEvalBar && (
                  <div className="tw-flex tw-items-center tw-justify-between tw-ml-4">
                    <span className="tw-text-sm tw-text-foreground">{t.display.evalBarMode}</span>
                    <Select
                      value={settings.evalBarMode}
                      onValueChange={(value) => setSettings({ evalBarMode: value as 'eval' | 'winrate' })}
                      options={[
                        { value: 'eval', label: t.display.evalBarModeEval },
                        { value: 'winrate', label: t.display.evalBarModeWinrate },
                      ]}
                    />
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Suggestions Tab */}
            <TabsContent value="suggestions">
              <div className="tw-space-y-4">
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

                <div className="tw-border-t tw-border-border tw-pt-4 tw-space-y-4">
                  <div className="tw-space-y-1">
                    <div className="tw-flex tw-items-center tw-justify-between">
                      <span className="tw-text-sm tw-text-foreground">{t.suggestions.showQualityLabels}</span>
                      <Switch
                        checked={settings.showQualityLabels}
                        onCheckedChange={(checked) => setSettings({ showQualityLabels: checked })}
                      />
                    </div>
                    <p className="tw-text-xs tw-text-muted">{t.suggestions.showQualityLabelsDesc}</p>
                  </div>

                  <div className="tw-space-y-1">
                    <div className="tw-flex tw-items-center tw-justify-between">
                      <span className="tw-text-sm tw-text-foreground">{t.suggestions.showEffectLabels}</span>
                      <Switch
                        checked={settings.showEffectLabels}
                        onCheckedChange={(checked) => setSettings({ showEffectLabels: checked })}
                      />
                    </div>
                    <p className="tw-text-xs tw-text-muted">{t.suggestions.showEffectLabelsDesc}</p>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Feedback Tab */}
            <TabsContent value="feedback">
              <div className="tw-space-y-4">
                <div className="tw-space-y-1">
                  <div className="tw-flex tw-items-center tw-justify-between">
                    <span className="tw-text-sm tw-text-foreground">{t.feedback.showSuggestions}</span>
                    <Switch
                      checked={settings.showSuggestions}
                      onCheckedChange={(checked) => setSettings({ showSuggestions: checked })}
                    />
                  </div>
                  <p className="tw-text-xs tw-text-muted">{t.feedback.showSuggestionsDesc}</p>
                </div>

                <div className="tw-space-y-1">
                  <div className="tw-flex tw-items-center tw-justify-between">
                    <span className="tw-text-sm tw-text-foreground">{t.feedback.showRollingAccuracy}</span>
                    <Switch
                      checked={settings.showRollingAccuracy}
                      onCheckedChange={(checked) => setSettings({ showRollingAccuracy: checked })}
                    />
                  </div>
                  <p className="tw-text-xs tw-text-muted">{t.feedback.showRollingAccuracyDesc}</p>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
