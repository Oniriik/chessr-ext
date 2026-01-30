import { randomUUID } from 'crypto';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

// Log categories with colors and icons
const categories: Record<string, { color: string; icon: string; label: string }> = {
  // Server lifecycle
  server_started: { color: colors.green, icon: '🚀', label: 'SERVER' },
  server_init_failed: { color: colors.red, icon: '💥', label: 'SERVER' },

  // Connection events
  client_connected: { color: colors.cyan, icon: '🔌', label: 'CONNECT' },
  client_disconnected: { color: colors.cyan, icon: '🔌', label: 'DISCONNECT' },
  websocket_error: { color: colors.red, icon: '❌', label: 'WS_ERROR' },

  // Authentication
  auth_request: { color: colors.yellow, icon: '🔑', label: 'AUTH' },
  auth_success: { color: colors.green, icon: '✅', label: 'AUTH' },
  auth_failed: { color: colors.red, icon: '🚫', label: 'AUTH' },
  token_expired: { color: colors.red, icon: '⏰', label: 'AUTH' },
  token_invalid: { color: colors.red, icon: '🚫', label: 'AUTH' },
  token_decode_failed: { color: colors.red, icon: '🚫', label: 'AUTH' },
  token_validation_error: { color: colors.red, icon: '🚫', label: 'AUTH' },

  // Analysis
  analysis_request: { color: colors.blue, icon: '♟️', label: 'ANALYSIS' },
  analysis_complete: { color: colors.green, icon: '✨', label: 'ANALYSIS' },
  analysis_error: { color: colors.red, icon: '❌', label: 'ANALYSIS' },
  stats_request: { color: colors.cyan, icon: '📊', label: 'REQUEST' },
  stats_complete: { color: colors.green, icon: '✨', label: 'STATS' },
  stats_error: { color: colors.red, icon: '❌', label: 'STATS' },
  stats_start: { color: colors.cyan, icon: '📊', label: 'STATS' },
  suggestions_request: { color: colors.magenta, icon: '💡', label: 'REQUEST' },
  suggestions_complete: { color: colors.green, icon: '✨', label: 'SUGGEST' },
  suggestions_error: { color: colors.red, icon: '❌', label: 'SUGGEST' },
  reset_before: { color: colors.yellow, icon: '🔄', label: 'RESET' },
  reset_after: { color: colors.green, icon: '✓', label: 'RESET' },
  suggestion_start: { color: colors.magenta, icon: '💡', label: 'SUGGEST' },

  // Candidate selector
  select_start: { color: colors.blue, icon: '🎯', label: 'SELECT' },
  select_ref: { color: colors.cyan, icon: '📊', label: 'SELECT' },
  select_cand: { color: colors.cyan, icon: '📋', label: 'SELECT' },
  select_accept: { color: colors.green, icon: '✓', label: 'SELECT' },
  select_sample: { color: colors.yellow, icon: '🎲', label: 'SELECT' },
  select_verify: { color: colors.yellow, icon: '🔍', label: 'SELECT' },
  select_result: { color: colors.green, icon: '✨', label: 'SELECT' },
  select_error: { color: colors.red, icon: '❌', label: 'SELECT' },

  // Errors
  parse_error: { color: colors.red, icon: '❌', label: 'ERROR' },
  unknown_message: { color: colors.yellow, icon: '❓', label: 'UNKNOWN' },

  // Pool lifecycle
  pool_init: { color: colors.cyan, icon: '🏊', label: 'POOL' },
  pool_ready: { color: colors.green, icon: '✅', label: 'POOL' },

  // Pool scaling
  pool_add: { color: colors.green, icon: '➕', label: 'POOL' },
  pool_remove: { color: colors.yellow, icon: '➖', label: 'POOL' },
  pool_scale_up: { color: colors.green, icon: '📈', label: 'POOL' },
  pool_scale_down: { color: colors.yellow, icon: '📉', label: 'POOL' },

  // Pool requests
  pool_assign: { color: colors.blue, icon: '→', label: 'POOL' },
  pool_queue: { color: colors.yellow, icon: '⏳', label: 'POOL' },
  pool_dequeue: { color: colors.blue, icon: '←', label: 'POOL' },
  pool_done: { color: colors.green, icon: '✓', label: 'POOL' },

  // Pool engine health
  pool_restart: { color: colors.yellow, icon: '🔄', label: 'POOL' },
  pool_dead: { color: colors.red, icon: '💀', label: 'POOL' },
  pool_error: { color: colors.red, icon: '💥', label: 'POOL' },

  // Legacy (keep for backward compat)
  pool_engine_added: { color: colors.green, icon: '➕', label: 'POOL' },
  pool_engine_removed: { color: colors.yellow, icon: '➖', label: 'POOL' },
  pool_engine_restart: { color: colors.yellow, icon: '🔄', label: 'POOL' },
  pool_engine_error: { color: colors.red, icon: '💥', label: 'POOL' },
  pool_engine_dead: { color: colors.red, icon: '💀', label: 'POOL' },
  pool_moves: { color: colors.blue, icon: '♟️', label: 'POOL' },

  // Engine events
  engine_error: { color: colors.red, icon: '❌', label: 'ENGINE' },
  engine_timeout: { color: colors.red, icon: '⏱️', label: 'ENGINE' },
  engine_exit: { color: colors.yellow, icon: '🚪', label: 'ENGINE' },
};

const defaultCategory = { color: colors.white, icon: '📝', label: 'LOG' };

function formatTimestamp(): string {
  const now = new Date();
  return `${colors.gray}${now.toISOString().slice(11, 23)}${colors.reset}`;
}

function formatRequestId(requestId: string): string {
  return `${colors.magenta}[${requestId}]${colors.reset}`;
}

function formatUser(user: string): string {
  if (user === 'anonymous') {
    return `${colors.dim}anonymous${colors.reset}`;
  }
  return `${colors.cyan}${user}${colors.reset}`;
}

function formatData(data?: Record<string, any>): string {
  if (!data || Object.keys(data).length === 0) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;

    let formattedValue: string;
    if (key === 'error') {
      formattedValue = `${colors.red}${value}${colors.reset}`;
    } else if (typeof value === 'number') {
      formattedValue = `${colors.yellow}${value}${colors.reset}`;
    } else if (typeof value === 'boolean') {
      formattedValue = value ? `${colors.green}true${colors.reset}` : `${colors.red}false${colors.reset}`;
    } else {
      formattedValue = `${colors.white}${value}${colors.reset}`;
    }
    parts.push(`${colors.gray}${key}=${colors.reset}${formattedValue}`);
  }

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export class Logger {
  private requestId: string;
  private userEmail: string;

  constructor(requestId?: string, userEmail?: string) {
    this.requestId = requestId || randomUUID().slice(0, 8);
    this.userEmail = userEmail || 'anonymous';
  }

  static createRequestId(): string {
    return randomUUID().slice(0, 8);
  }

  private format(name: string, user: string, data?: Record<string, any>, phase?: 'started' | 'ended'): string {
    const cat = categories[name] || defaultCategory;
    const timestamp = formatTimestamp();
    const reqId = formatRequestId(this.requestId);
    const label = `${colors.cyan}[${cat.icon} ${cat.label}]${colors.reset}`;
    const phaseColor = phase === 'started' ? colors.yellow : phase === 'ended' ? colors.green : '';
    const phaseLabel = phase ? `${phaseColor}[${phase}]${colors.reset}` : '';
    const userName = formatUser(user);
    const dataStr = formatData(data);

    return `${timestamp} ${reqId} ${label} ${phaseLabel} ${userName}${dataStr}`.replace(/\s+/g, ' ').trim();
  }

  info(name: string, userOrData?: string | Record<string, any>, dataOrPhase?: Record<string, any> | 'started' | 'ended', phase?: 'started' | 'ended'): void {
    if (typeof userOrData === 'string') {
      // Old signature: info(name, user, data?, phase?)
      const data = typeof dataOrPhase === 'object' ? dataOrPhase : undefined;
      const actualPhase = typeof dataOrPhase === 'string' ? dataOrPhase : phase;
      console.log(this.format(name, userOrData, data, actualPhase));
    } else {
      // New signature: info(name, data?, phase?)
      const data = userOrData;
      const actualPhase = typeof dataOrPhase === 'string' ? dataOrPhase : undefined;
      console.log(this.format(name, this.userEmail, data, actualPhase));
    }
  }

  error(name: string, user: string | Error, error?: Error | string | Record<string, any>, data?: Record<string, any>): void {
    // Support both old and new signatures
    // Old: error(name, user, error, data?)
    // New: error(name, error, data?)
    if (user instanceof Error || typeof user === 'string' && !error) {
      // New signature: error(name, error, data?)
      const errorMessage = user instanceof Error ? user.message : user;
      console.log(this.format(name, this.userEmail, { ...data, error: errorMessage }));
    } else {
      // Old signature: error(name, user, error, data?)
      const errorMessage = error instanceof Error ? error.message : error;
      console.log(this.format(name, user as string, { ...data as Record<string, any>, error: errorMessage }));
    }
  }
}

// Global logger for non-request-scoped logs
export const globalLogger = {
  info(name: string, data?: Record<string, any>): void {
    const cat = categories[name] || defaultCategory;
    const timestamp = formatTimestamp();
    const label = `${colors.cyan}[${cat.icon} ${cat.label}]${colors.reset}`;
    const dataStr = formatData(data);

    console.log(`${timestamp} ${label}${dataStr}`);
  },

  error(name: string, error: Error | string, data?: Record<string, any>): void {
    const cat = categories[name] || defaultCategory;
    const timestamp = formatTimestamp();
    const label = `${colors.cyan}[${cat.icon} ${cat.label}]${colors.reset}`;
    const errorMessage = error instanceof Error ? error.message : error;
    const dataStr = formatData({ ...data, error: errorMessage });

    console.log(`${timestamp} ${label}${dataStr}`);
  },
};

// Pool logger with dedicated format
type PoolAction = 'acquire' | 'release' | 'init' | 'ready' | 'add' | 'remove' | 'scale_up' | 'scale_down' | 'restart' | 'dead' | 'error';

export const poolLogger = {
  log(action: PoolAction, pool: number, available: number, extraData?: Record<string, any>): void {
    const timestamp = formatTimestamp();

    // Color-code the action based on type
    let actionColor = colors.cyan;
    if (action === 'restart') {
      actionColor = colors.yellow;
    } else if (action === 'dead' || action === 'error') {
      actionColor = colors.red;
    } else if (action === 'scale_up') {
      actionColor = colors.green;
    }

    const label = `${colors.cyan}[POOL]${colors.reset}`;
    const actionLabel = `${actionColor}[${action.toUpperCase()}]${colors.reset}`;
    const poolData = `${colors.gray}pool=${colors.reset}${colors.yellow}${pool}${colors.reset} ${colors.gray}available=${colors.reset}${colors.yellow}${available}${colors.reset}`;
    const extraStr = extraData ? ' ' + formatData(extraData) : '';

    console.log(`${timestamp} ${label} ${actionLabel} ${poolData}${extraStr}`);
  },
};
