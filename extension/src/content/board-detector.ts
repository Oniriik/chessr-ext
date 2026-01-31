import { BoardConfig } from '../shared/types';
import { createPlatformAdapter } from './platforms';

/**
 * Detect the chess board on the current page.
 * This is a convenience wrapper that creates the appropriate platform adapter
 * and calls its detectBoard method.
 */
export function detectBoard(): BoardConfig | null {
  const adapter = createPlatformAdapter();
  if (!adapter) return null;
  return adapter.detectBoard();
}
