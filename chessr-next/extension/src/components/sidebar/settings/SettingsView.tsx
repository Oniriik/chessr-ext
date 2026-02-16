import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AccountTab } from "./AccountTab";
import { GeneralTab } from "./GeneralTab";

export function SettingsView() {
  return (
    <Tabs defaultValue="account" className="tw-w-full">
      <TabsList className="tw-w-full">
        <TabsTrigger value="account" className="tw-flex-1">Account</TabsTrigger>
        <TabsTrigger value="general" className="tw-flex-1">General</TabsTrigger>
        <TabsTrigger value="suggestions" className="tw-flex-1">Suggestions</TabsTrigger>
      </TabsList>
      <TabsContent value="account">
        <AccountTab />
      </TabsContent>
      <TabsContent value="general">
        <GeneralTab />
      </TabsContent>
      <TabsContent value="suggestions">
        <div className="tw-text-sm tw-text-muted-foreground tw-py-4">
          Suggestions settings coming soon...
        </div>
      </TabsContent>
    </Tabs>
  );
}
