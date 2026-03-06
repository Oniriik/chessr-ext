import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AccountTab } from "./AccountTab";
import { GeneralTab } from "./GeneralTab";
import { SuggestionsTab } from "./SuggestionsTab";

export function SettingsView() {
  const { t } = useTranslation('settings');

  return (
    <Tabs defaultValue="account" className="tw-w-full tw-flex-1 tw-flex tw-flex-col tw-overflow-hidden">
      <TabsList className="tw-w-full tw-flex-shrink-0">
        <TabsTrigger value="account" className="tw-flex-1">{t('account')}</TabsTrigger>
        <TabsTrigger value="general" className="tw-flex-1">{t('general')}</TabsTrigger>
        <TabsTrigger value="suggestions" className="tw-flex-1">{t('suggestions')}</TabsTrigger>
      </TabsList>
      <TabsContent value="account" className="tw-flex-1 tw-overflow-y-auto">
        <AccountTab />
      </TabsContent>
      <TabsContent value="general" className="tw-flex-1 tw-overflow-y-auto">
        <GeneralTab />
      </TabsContent>
      <TabsContent value="suggestions" className="tw-flex-1 tw-overflow-y-auto">
        <SuggestionsTab />
      </TabsContent>
    </Tabs>
  );
}
