import { AlertTriangle, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../store/app.store';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { cn } from '../lib/utils';
import { getCurrentVersion } from '../../shared/version';

export function UpdateRequiredView() {
  const { t } = useTranslation();
  const { minVersion, downloadUrl, connected, sidebarOpen, toggleSidebar } = useAppStore();

  const currentVersion = getCurrentVersion();

  return (
    <div className="tw-fixed tw-right-0 tw-top-0 tw-h-screen tw-z-[10000] tw-flex tw-font-sans">
      {/* Toggle button - always visible on the left side */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleSidebar}
        className="tw-self-center tw-bg-background tw-text-gray-200 tw-p-2 tw-rounded-l-lg tw-rounded-r-none tw-shadow-lg hover:tw-bg-card tw-border tw-border-r-0 tw-border-gray-700 tw-h-auto"
      >
        {sidebarOpen ? <ChevronRight className="tw-w-5 tw-h-5" /> : <ChevronLeft className="tw-w-5 tw-h-5" />}
      </Button>

      {/* Sidebar content - conditionally rendered */}
      {sidebarOpen && (
        <div className="tw-w-72 tw-bg-background tw-text-foreground tw-shadow-2xl tw-flex tw-flex-col tw-h-full">
          {/* Header */}
          <div className="tw-p-4 tw-border-b tw-border-gray-700">
            <div className="tw-flex tw-items-center tw-gap-2">
              <div className={cn('tw-w-2.5 tw-h-2.5 tw-rounded-full', connected ? 'tw-bg-success' : 'tw-bg-danger')} />
              <span className="tw-font-semibold tw-text-sm">Chessr</span>
            </div>
          </div>

          {/* Content */}
          <div className="tw-flex-1 tw-overflow-y-auto tw-p-4 tw-space-y-4">
            <Card>
              <div className="tw-flex tw-flex-col tw-items-center tw-text-center">
                <div className="tw-w-12 tw-h-12 tw-rounded-full tw-bg-red-900/50 tw-flex tw-items-center tw-justify-center tw-mb-3">
                  <AlertTriangle className="tw-w-6 tw-h-6 tw-text-red-400" />
                </div>

                <h2 className="tw-text-lg tw-font-bold tw-text-foreground tw-mb-2">
                  {t.version.title}
                </h2>

                <p className="tw-text-xs tw-text-muted tw-mb-3">
                  {t.version.message}
                </p>

                <div className="tw-text-xs tw-text-muted tw-mb-4 tw-bg-background tw-rounded tw-px-3 tw-py-2 tw-w-full">
                  {t.version.current}: <span className="tw-text-red-400 tw-font-semibold">{currentVersion}</span>
                  {' → '}
                  {t.version.required}: <span className="tw-text-green-400 tw-font-semibold">{minVersion}</span>
                </div>

                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tw-w-full"
                  >
                    <Button className="tw-w-full">
                      <Download className="tw-w-4 tw-h-4 tw-mr-2" />
                      {t.version.download}
                    </Button>
                  </a>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
