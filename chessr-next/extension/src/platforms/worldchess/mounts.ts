import { MountPoint } from '../types';
import { SidebarMount } from '../../components/sidebar/SidebarMount';
import { LichessSidebarTrigger } from '../../components/sidebar/LichessSidebarTrigger';
import { FloatingSidebar } from '../../components/sidebar/FloatingSidebar';
import { GameDetector } from '../../components/sidebar/GameDetector';

export function getMountPoints(): MountPoint[] {
  return [
    // Header trigger (all pages) — opens floating sidebar
    {
      id: 'worldchess-header-trigger',
      route: ['game', 'home', 'puzzle', 'unknown'],
      selector: '[data-component="HeaderTools"]',
      position: 'prepend',
      component: LichessSidebarTrigger,
    },
    // Game toolbar toggle (game page) — swaps notation with Chessr sidebar
    {
      id: 'worldchess-game-toggle',
      route: 'game',
      selector: '[data-component="GameToolbar"]',
      position: 'append',
      component: SidebarMount,
      props: {
        originalSidebarSelector: '[data-component="GameLayoutRightbarNotation"]',
      },
    },
    // Floating sidebar (all pages)
    {
      id: 'worldchess-floating-sidebar',
      route: ['home', 'puzzle', 'unknown'],
      selector: 'body',
      position: 'append',
      component: FloatingSidebar,
    },
    // Game detector — always mounted on game pages
    {
      id: 'game-detector',
      route: 'game',
      selector: 'body',
      position: 'append',
      component: GameDetector,
    },
  ];
}
