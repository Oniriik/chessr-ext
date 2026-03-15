import { MountPoint } from '../types';
import { FloatingSidebar } from '../../components/sidebar/FloatingSidebar';
import { GameDetector } from '../../components/sidebar/GameDetector';
import { LichessSidebarTrigger } from '../../components/sidebar/LichessSidebarTrigger';
import { PuzzleSidebar } from '../../components/sidebar/PuzzleSidebar';

export function getMountPoints(): MountPoint[] {
  return [
    // Sidebar trigger button (fixed position)
    {
      id: 'lichess-sidebar-trigger',
      route: ['game', 'analysis', 'home', 'puzzle', 'unknown'],
      selector: 'body',
      position: 'append',
      component: LichessSidebarTrigger,
    },
    // Floating sidebar for all pages (except puzzle which has its own)
    {
      id: 'lichess-floating-sidebar',
      route: ['game', 'analysis', 'home', 'unknown'],
      selector: 'body',
      position: 'append',
      component: FloatingSidebar,
    },
    // Game detector — always mounted so DOM watchers run even in streamer mode
    {
      id: 'game-detector',
      route: ['game'],
      selector: 'body',
      position: 'append',
      component: GameDetector,
    },
    // Puzzle sidebar for training/streak (appended inside metas area)
    {
      id: 'lichess-puzzle-sidebar',
      route: 'puzzle',
      selector: '.puzzle__side__metas',
      position: 'append',
      component: PuzzleSidebar,
    },
    // Puzzle sidebar for storm (above the clock)
    {
      id: 'lichess-storm-sidebar',
      route: 'puzzle',
      selector: '.puz-clock',
      position: 'before',
      component: PuzzleSidebar,
    },
  ];
}
