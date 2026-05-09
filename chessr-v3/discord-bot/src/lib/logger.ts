import { config } from '../config.js';

// Minimal level-gated logger so the bot's stdout is grep-friendly in
// docker logs. No coloring (ANSI escapes survive `docker logs` but get
// noisy in journalctl); a uniform `[lvl]` prefix is enough.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const min = LEVELS[config.logLevel] ?? LEVELS.info;

function emit(level: Level, args: unknown[]): void {
  if (LEVELS[level] < min) return;
  const prefix = `[${level}]`;
  if (level === 'error')      console.error(prefix, ...args);
  else if (level === 'warn')  console.warn(prefix, ...args);
  else                        console.log(prefix, ...args);
}

export const log = {
  debug: (...args: unknown[]) => emit('debug', args),
  info:  (...args: unknown[]) => emit('info',  args),
  warn:  (...args: unknown[]) => emit('warn',  args),
  error: (...args: unknown[]) => emit('error', args),
};
