import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { AuthGuard } from '../auth';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/button';
import { LogOut } from 'lucide-react';

function AuthenticatedContent() {
  const { user, signOut } = useAuthStore();

  return (
    <Card className="tw-w-full tw-h-full tw-min-h-[200px]">
      <CardHeader className="tw-flex tw-flex-row tw-items-center tw-justify-between tw-space-y-0 tw-pb-2">
        <CardTitle className="tw-text-lg">Chessr.io</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={signOut}
          className="tw-h-8 tw-w-8"
          title="Sign out"
        >
          <LogOut className="tw-h-4 tw-w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <p className="tw-text-muted-foreground tw-text-sm">
          Signed in as {user?.email}
        </p>
      </CardContent>
    </Card>
  );
}

export function SidebarContent() {
  return (
    <AuthGuard>
      <AuthenticatedContent />
    </AuthGuard>
  );
}
