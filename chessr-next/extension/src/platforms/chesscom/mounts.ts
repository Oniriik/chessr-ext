import { MountPoint } from '../types';
import { SidebarMount } from '../../components/sidebar/SidebarMount';
import { BaseSidebarTrigger } from '../../components/sidebar/BaseSidebarTrigger';
import { FloatingSidebar } from '../../components/sidebar/FloatingSidebar';

export function getMountPoints(): MountPoint[] {
  return [
    // Base sidebar trigger (navigation sidebar on left)
    {
      id: 'base-sidebar-trigger',
      route: ['home', 'play-computer', 'play-online', 'analysis', 'game', 'unknown'],
      selector: '.sidebar-link[data-user-activity-key="profile"]',
      position: 'after',
      component: BaseSidebarTrigger,
    },
    // Floating sidebar for pages without a dedicated sidebar
    {
      id: 'floating-sidebar',
      route: ['home', 'analysis', 'game', 'unknown'],
      selector: 'body',
      position: 'append',
      component: FloatingSidebar,
    },
    // Play vs Computer page
    {
      id: 'play-computer-toggle',
      route: 'play-computer',
      selector: '#player-bottom .player-row-container',
      position: 'after',
      component: SidebarMount,
      props: {
        originalSidebarSelector: '#board-layout-sidebar',
        inheritClass: 'board-layout-sidebar',
      },
    },
    // Play Online page
    {
      id: 'play-online-toggle',
      route: 'play-online',
      selector: '#board-layout-player-bottom .player-playerContent',
      position: 'after',
      component: SidebarMount,
      props: {
        originalSidebarSelector: '#board-layout-sidebar',
        inheritClass: 'board-layout-sidebar',
      },
      parentStyles: {
        gap: '8px',
      },
    },
  ];
}
