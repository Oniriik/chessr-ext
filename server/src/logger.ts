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

  // Errors
  parse_error: { color: colors.red, icon: '❌', label: 'ERROR' },
  unknown_message: { color: colors.yellow, icon: '❓', label: 'UNKNOWN' },

  // Pool events
  pool_init: { color: colors.cyan, icon: '🏊', label: 'POOL' },
  pool_ready: { color: colors.green, icon: '✅', label: 'POOL' },
  pool_engine_added: { color: colors.cyan, icon: '➕', label: 'POOL' },
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

  constructor(requestId?: string) {
    this.requestId = requestId || randomUUID().slice(0, 8);
  }

  static createRequestId(): string {
    return randomUUID().slice(0, 8);
  }

  private format(name: string, user: string, data?: Record<string, any>): string {
    const cat = categories[name] || defaultCategory;
    const timestamp = formatTimestamp();
    const reqId = formatRequestId(this.requestId);
    const label = `${cat.color}${cat.icon} ${cat.label.padEnd(10)}${colors.reset}`;
    const userName = formatUser(user);
    const dataStr = formatData(data);

    return `${timestamp} ${reqId} ${label} ${userName}${dataStr}`;
  }

  info(name: string, user: string, data?: Record<string, any>): void {
    console.log(this.format(name, user, data));
  }

  error(name: string, user: string, error: Error | string, data?: Record<string, any>): void {
    const errorMessage = error instanceof Error ? error.message : error;
    console.log(this.format(name, user, { ...data, error: errorMessage }));
  }
}

// Global logger for non-request-scoped logs
export const globalLogger = {
  info(name: string, data?: Record<string, any>): void {
    const cat = categories[name] || defaultCategory;
    const timestamp = formatTimestamp();
    const label = `${cat.color}${cat.icon} ${cat.label.padEnd(10)}${colors.reset}`;
    const dataStr = formatData(data);

    console.log(`${timestamp} ${label}${dataStr}`);
  },

  error(name: string, error: Error | string, data?: Record<string, any>): void {
    const cat = categories[name] || defaultCategory;
    const timestamp = formatTimestamp();
    const label = `${cat.color}${cat.icon} ${cat.label.padEnd(10)}${colors.reset}`;
    const errorMessage = error instanceof Error ? error.message : error;
    const dataStr = formatData({ ...data, error: errorMessage });

    console.log(`${timestamp} ${label}${dataStr}`);
  },
};
