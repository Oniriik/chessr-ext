import { useEffect } from 'react';
import { MountPoint } from '../types';
import { SidebarMount } from '../../components/sidebar/SidebarMount';
import { WorldChessHeaderTrigger } from '../../components/sidebar/WorldChessSidebarTrigger';
import { FloatingSidebar } from '../../components/sidebar/FloatingSidebar';
import { GameDetector } from '../../components/sidebar/GameDetector';

/**
 * Floating sidebar that only renders when NOT in a game (no GameToolbar present).
 */
function WorldChessFloatingSidebar() {
  const hasGameToolbar = !!document.querySelector('[data-component="GameToolbar"]');
  if (hasGameToolbar) return null;
  return <FloatingSidebar />;
}

/**
 * Applies inline style overrides to WorldChess layout elements.
 */
function WorldChessStyleOverrides() {
  useEffect(() => {
    const content = document.querySelector('[data-component="GameLayoutContent"]') as HTMLElement | null;
    const rightbarFirstChild = document.querySelector('[data-component="GameLayoutRightbar"] > :first-child') as HTMLElement | null;

    if (content) { content.style.padding = '0'; content.style.paddingLeft = '90px'; }
    if (rightbarFirstChild) rightbarFirstChild.style.paddingLeft = '0';

    return () => {
      if (content) { content.style.padding = ''; content.style.paddingLeft = ''; }
      if (rightbarFirstChild) rightbarFirstChild.style.paddingLeft = '';
    };
  }, []);
  return null;
}

export function getMountPoints(): MountPoint[] {
  return [
    // Header trigger — inline button in the top bar (all pages)
    {
      id: 'worldchess-header-trigger',
      route: ['game', 'home', 'puzzle', 'unknown'],
      selector: '[data-component="HeaderToolsItem"][data-id="Themes"]',
      position: 'before',
      component: WorldChessHeaderTrigger,
    },
    // Game toggle — swaps notation with Chessr sidebar
    {
      id: 'worldchess-game-toggle',
      route: ['game', 'home', 'puzzle', 'unknown'],
      selector: '[data-component="GameToolbar"]',
      position: 'append',
      component: SidebarMount,
      props: {
        originalSidebarSelector: '[data-component="GameLayoutRightbarNotation"]',
      },
    },
    // Floating sidebar (all pages — but won't show when GameToolbar exists since SidebarMount takes over)
    {
      id: 'worldchess-floating-sidebar',
      route: ['game', 'home', 'puzzle', 'unknown'],
      selector: 'body',
      position: 'append',
      component: WorldChessFloatingSidebar,
    },
    // Style overrides for WorldChess layout (selector only exists on game pages)
    {
      id: 'worldchess-style-overrides',
      route: ['game', 'home', 'puzzle', 'unknown'],
      selector: '[data-component="GameLayout"]',
      position: 'append',
      component: WorldChessStyleOverrides,
    },
    // Game detector — always mounted (WorldChess is SPA, user can navigate to game from any page)
    {
      id: 'game-detector',
      route: ['game', 'home', 'puzzle', 'unknown'],
      selector: 'body',
      position: 'append',
      component: GameDetector,
    },
  ];
}
