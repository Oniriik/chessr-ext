import { AlertTriangle, Download, X } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { useAppStore } from '../store/app.store';
import { Button } from './ui/button';
import { getCurrentVersion } from '../../shared/version';

export function CriticalUpdateModal() {
  const { t } = useTranslation();
  const { updateRequired, minVersion, downloadUrl, dismissUpdate } = useAppStore();

  // Only show for critical updates
  if (!updateRequired || !minVersion || !downloadUrl) {
    return null;
  }

  const currentVersion = getCurrentVersion();

  return (
    <div className="tw-fixed tw-inset-0 tw-z-[10001] tw-flex tw-items-center tw-justify-center tw-font-sans">
      {/* Overlay */}
      <div className="tw-absolute tw-inset-0 tw-bg-black/80" onClick={dismissUpdate} />

      {/* Modal */}
      <div className="tw-relative tw-bg-background tw-rounded-lg tw-p-6 tw-w-96 tw-max-w-[90vw] tw-shadow-2xl tw-border tw-border-red-700">
        {/* Close button */}
        <button
          onClick={dismissUpdate}
          className="tw-absolute tw-top-3 tw-right-3 tw-text-muted hover:tw-text-foreground tw-transition-colors"
        >
          <X className="tw-w-5 tw-h-5" />
        </button>

        <div className="tw-flex tw-flex-col tw-items-center tw-text-center">
          <div className="tw-w-12 tw-h-12 tw-rounded-full tw-bg-red-900/50 tw-flex tw-items-center tw-justify-center tw-mb-4">
            <AlertTriangle className="tw-w-6 tw-h-6 tw-text-red-400" />
          </div>

          <h2 className="tw-text-xl tw-font-bold tw-text-foreground tw-mb-2">
            {t.version.title}
          </h2>

          <p className="tw-text-sm tw-text-muted tw-mb-4">
            {t.version.message}
          </p>

          <div className="tw-text-xs tw-text-muted tw-mb-4 tw-bg-card tw-rounded tw-px-3 tw-py-2">
            {t.version.current}: <span className="tw-text-red-400">{currentVersion}</span>
            {' → '}
            {t.version.required}: <span className="tw-text-green-400">{minVersion}</span>
          </div>

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
        </div>
      </div>
    </div>
  );
}
