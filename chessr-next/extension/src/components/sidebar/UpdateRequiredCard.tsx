/**
 * UpdateRequiredCard - Displayed when extension version is outdated
 * This is a mandatory update - no dismiss option
 */

import { AlertTriangle, Download } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useVersionStore } from '../../stores/versionStore';

export function UpdateRequiredCard() {
  const { currentVersion, minVersion, downloadUrl } = useVersionStore();

  return (
    <Card className="tw-bg-gradient-to-br tw-from-red-500/10 tw-to-orange-500/10 tw-border-red-500/20">
      <CardContent className="tw-py-6 tw-px-4 tw-space-y-4">
        <div className="tw-flex tw-flex-col tw-items-center tw-text-center tw-gap-3">
          <div className="tw-p-3 tw-rounded-xl tw-bg-red-500/20">
            <AlertTriangle className="tw-w-8 tw-h-8 tw-text-red-500" />
          </div>
          <div>
            <p className="tw-text-base tw-font-semibold tw-text-foreground">
              Update Required
            </p>
            <p className="tw-text-sm tw-text-muted-foreground tw-mt-1">
              A new version is available
            </p>
          </div>
        </div>

        {/* Version info */}
        <div className="tw-flex tw-justify-center tw-gap-4 tw-text-sm">
          <div className="tw-text-center">
            <p className="tw-text-xs tw-text-muted-foreground">Current</p>
            <p className="tw-font-mono tw-text-red-400">{currentVersion}</p>
          </div>
          <div className="tw-text-center">
            <p className="tw-text-xs tw-text-muted-foreground">Required</p>
            <p className="tw-font-mono tw-text-green-400">{minVersion}</p>
          </div>
        </div>

        <Button
          onClick={() => window.open(downloadUrl || 'https://download.chessr.io', '_blank')}
          className="tw-w-full tw-bg-gradient-to-r tw-from-red-500 tw-to-orange-500 hover:tw-from-red-600 hover:tw-to-orange-600 tw-text-white tw-font-medium"
        >
          <Download className="tw-w-4 tw-h-4 tw-mr-2" />
          Download Update
        </Button>
      </CardContent>
    </Card>
  );
}
