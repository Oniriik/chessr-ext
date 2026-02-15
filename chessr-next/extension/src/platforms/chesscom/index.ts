import { Platform } from '../types';
import { detectRoute } from './routes';
import { getMountPoints } from './mounts';

export const chesscom: Platform = {
  id: 'chesscom',
  name: 'Chess.com',
  hostname: /^(www\.)?chess\.com$/,
  detectRoute,
  getMountPoints,
};
