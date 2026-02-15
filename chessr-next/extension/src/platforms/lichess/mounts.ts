import { MountPoint } from '../types';

// Placeholder component for now
const Placeholder = () => null;

export function getMountPoints(): MountPoint[] {
  return [
    {
      id: 'game-sidebar',
      route: 'game',
      selector: '.rclock-bottom',
      position: 'after',
      component: Placeholder,
    },
    {
      id: 'analysis-sidebar',
      route: 'analysis',
      selector: '.analyse__tools',
      position: 'after',
      component: Placeholder,
    },
  ];
}
