/**
 * Logger utility for Chessr extension
 * Colored prefix [chessr.io] with level-based colors
 */

const CHESSR_BLUE = '#3c83f6';

const STYLES = {
  prefix: `color: ${CHESSR_BLUE}; font-weight: bold`,
  info: 'color: #94a3b8',      // slate-400
  warn: 'color: #f59e0b',      // amber-500
  error: 'color: #ef4444',     // red-500
  debug: 'color: #8b5cf6',     // violet-500
  success: 'color: #10b981',   // emerald-500
} as const;

function formatLog(level: keyof typeof STYLES, message: string, data: unknown[]) {
  const style = STYLES[level];
  if (data.length > 0) {
    console.log(`%c[chessr.io]%c ${message}`, STYLES.prefix, style, ...data);
  } else {
    console.log(`%c[chessr.io]%c ${message}`, STYLES.prefix, style);
  }
}

export const logger = {
  /** Info-level log (gray) */
  log: (message: string, ...data: unknown[]) => {
    formatLog('info', message, data);
  },

  /** Alias for log */
  info: (message: string, ...data: unknown[]) => {
    formatLog('info', message, data);
  },

  /** Warning log (amber) */
  warn: (message: string, ...data: unknown[]) => {
    formatLog('warn', `⚠ ${message}`, data);
  },

  /** Error log (red) */
  error: (message: string, ...data: unknown[]) => {
    formatLog('error', `✖ ${message}`, data);
  },

  /** Debug log (violet) - only in dev */
  debug: (message: string, ...data: unknown[]) => {
    formatLog('debug', message, data);
  },

  /** Success log (green) */
  success: (message: string, ...data: unknown[]) => {
    formatLog('success', `✓ ${message}`, data);
  },

  /** Collapsed group - click to expand */
  group: (label: string, fn: () => void) => {
    console.groupCollapsed(`%c[chessr.io]%c ${label}`, STYLES.prefix, STYLES.info);
    fn();
    console.groupEnd();
  },
};
