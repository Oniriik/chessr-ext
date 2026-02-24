import { Platform } from '../types';
import { detectRoute } from './routes';
import { getMountPoints } from './mounts';

// Re-export detection functions from lib
export {
  detectGameStarted,
  detectPlayerColor,
  detectCurrentTurn,
  detectRatings,
  extractMovesFromDOM,
  getMoveListElement,
  getMoveSelector,
} from '../../lib/lichess';

export const lichess: Platform = {
  id: 'lichess',
  name: 'Lichess',
  hostname: /^lichess\.org$/,
  detectRoute,
  getMountPoints,
};
