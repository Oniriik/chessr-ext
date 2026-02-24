/**
 * Structured request logger with colors
 * Format: [timestamp] [requestId] [email] [type] [params] [status]
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

// Track request start times for duration calculation
const requestStartTimes = new Map<string, number>();

/**
 * Format timestamp as HH:mm:ss
 */
function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * Truncate string to max length with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Format duration in seconds
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Get color for request type
 */
function getTypeColor(type: RequestType): string {
  switch (type) {
    case 'suggestion': return colors.yellow;
    case 'analyze': return colors.blue;
    case 'connect': return colors.green;
    case 'disconnect': return colors.red;
    default: return colors.white;
  }
}

export type RequestType = 'suggestion' | 'analyze' | 'auth' | 'connect' | 'disconnect';

interface LogStartParams {
  requestId: string;
  email: string;
  type: RequestType;
  params?: string;
}

interface LogEndParams {
  requestId: string;
  email: string;
  type: RequestType;
  result?: string;
}

/**
 * Log request start
 */
export function logStart({ requestId, email, type, params }: LogStartParams): void {
  const c = colors;
  const timestamp = formatTimestamp();
  const shortId = requestId.slice(0, 8);
  const shortEmail = truncate(email, 25);
  const paramsStr = params || '';
  const typeColor = getTypeColor(type);

  requestStartTimes.set(requestId, Date.now());

  console.log(
    `${c.dim}[${timestamp}]${c.reset} ` +
    `${c.cyan}[${shortId}]${c.reset} ` +
    `${c.white}[${shortEmail}]${c.reset} ` +
    `${typeColor}[${type}]${c.reset} ` +
    `${c.dim}${paramsStr}${c.reset} ` +
    `${c.green}[started]${c.reset}`
  );
}

/**
 * Log request end with duration
 */
export function logEnd({ requestId, email, type, result }: LogEndParams): void {
  const c = colors;
  const timestamp = formatTimestamp();
  const shortId = requestId.slice(0, 8);
  const shortEmail = truncate(email, 25);
  const resultStr = result || '';
  const typeColor = getTypeColor(type);

  const startTime = requestStartTimes.get(requestId);
  const duration = startTime ? formatDuration(Date.now() - startTime) : '?';
  requestStartTimes.delete(requestId);

  console.log(
    `${c.dim}[${timestamp}]${c.reset} ` +
    `${c.cyan}[${shortId}]${c.reset} ` +
    `${c.white}[${shortEmail}]${c.reset} ` +
    `${typeColor}[${type}]${c.reset} ` +
    `${c.dim}${resultStr}${c.reset} ` +
    `${c.cyan}[ended ${duration}]${c.reset}`
  );
}

/**
 * Log request error
 */
export function logError({ requestId, email, type, error }: LogEndParams & { error: string }): void {
  const c = colors;
  const timestamp = formatTimestamp();
  const shortId = requestId.slice(0, 8);
  const shortEmail = truncate(email, 25);
  const errorStr = truncate(error, 50);
  const typeColor = getTypeColor(type);

  const startTime = requestStartTimes.get(requestId);
  const duration = startTime ? formatDuration(Date.now() - startTime) : '?';
  requestStartTimes.delete(requestId);

  console.log(
    `${c.dim}[${timestamp}]${c.reset} ` +
    `${c.cyan}[${shortId}]${c.reset} ` +
    `${c.white}[${shortEmail}]${c.reset} ` +
    `${typeColor}[${type}]${c.reset} ` +
    `${c.red}${errorStr}${c.reset} ` +
    `${c.red}[failed ${duration}]${c.reset}`
  );
}

/**
 * Log connection events (no requestId)
 */
export function logConnection(email: string, event: 'connected' | 'disconnected'): void {
  const c = colors;
  const timestamp = formatTimestamp();
  const shortEmail = truncate(email, 25);
  const statusColor = event === 'connected' ? c.green : c.red;

  console.log(
    `${c.dim}[${timestamp}]${c.reset} ` +
    `${c.white}[${shortEmail}]${c.reset} ` +
    `${statusColor}[${event}]${c.reset}`
  );
}
