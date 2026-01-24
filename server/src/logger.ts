import { randomUUID } from 'crypto';

export interface LogEntry {
  name: string;
  user: string;
  data?: Record<string, any>;
}

export class Logger {
  private requestId: string;

  constructor(requestId?: string) {
    this.requestId = requestId || randomUUID().slice(0, 8);
  }

  static createRequestId(): string {
    return randomUUID().slice(0, 8);
  }

  log(entry: LogEntry): void {
    const timestamp = new Date().toISOString();
    const logLine = {
      timestamp,
      requestId: this.requestId,
      ...entry,
    };
    console.log(JSON.stringify(logLine));
  }

  info(name: string, user: string, data?: Record<string, any>): void {
    this.log({ name, user, data });
  }

  error(name: string, user: string, error: Error | string, data?: Record<string, any>): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this.log({
      name,
      user,
      data: { ...data, error: errorMessage },
    });
  }
}

// Global logger for non-request-scoped logs
export const globalLogger = {
  info(name: string, data?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({ timestamp, name, ...data }));
  },
  error(name: string, error: Error | string, data?: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : error;
    console.log(JSON.stringify({ timestamp, name, error: errorMessage, ...data }));
  },
};
