import { Wrench } from 'lucide-react';
import { useMaintenanceStore } from '../../stores/maintenanceStore';

/**
 * Format a time string: "3:00 PM"
 */
function formatTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format a date prefix: "Today" or "Feb 28"
 */
function formatDatePrefix(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const now = new Date();

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) return 'Today';

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isSameDay(a: number, b: number): boolean {
  const da = new Date(a * 1000);
  const db = new Date(b * 1000);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * Build the display string for the maintenance window.
 * Same day:  "Today 3:00 PM — 5:00 PM"  or  "Feb 28 3:00 PM — 5:00 PM"
 * Diff days: "Today 3:00 PM — Feb 29 5:00 PM"
 */
function formatMaintenanceRange(start: number, end: number | null): string {
  const prefix = formatDatePrefix(start);
  const startTime = formatTime(start);

  if (!end) return `${prefix} ${startTime}`;

  if (isSameDay(start, end)) {
    return `${prefix} ${startTime} — ${formatTime(end)}`;
  }

  return `${prefix} ${startTime} — ${formatDatePrefix(end)} ${formatTime(end)}`;
}

export function MaintenanceBanner() {
  const scheduledAt = useMaintenanceStore((s) => s.scheduledAt);
  const endAt = useMaintenanceStore((s) => s.endAt);

  if (!scheduledAt) return null;

  return (
    <div className="tw-flex tw-items-center tw-gap-2 tw-px-3 tw-py-2 tw-rounded-lg tw-bg-orange-500/15 tw-border tw-border-orange-500/30 tw-text-orange-300">
      <Wrench className="tw-w-4 tw-h-4 tw-text-orange-400 tw-flex-shrink-0" />
      <p className="tw-text-xs tw-flex-1">
        Maintenance: <span className="tw-font-medium">{formatMaintenanceRange(scheduledAt, endAt)}</span>
      </p>
    </div>
  );
}
