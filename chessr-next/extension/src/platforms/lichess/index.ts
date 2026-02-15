import { Platform } from '../types';
import { detectRoute } from './routes';
import { getMountPoints } from './mounts';

export const lichess: Platform = {
  id: 'lichess',
  name: 'Lichess',
  hostname: /^lichess\.org$/,
  detectRoute,
  getMountPoints,
};
