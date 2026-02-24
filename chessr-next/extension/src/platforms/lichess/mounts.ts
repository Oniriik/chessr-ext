import { MountPoint } from '../types';
import { FloatingSidebar } from '../../components/sidebar/FloatingSidebar';
import { LichessSidebarTrigger } from '../../components/sidebar/LichessSidebarTrigger';

export function getMountPoints(): MountPoint[] {
  return [
    // Sidebar trigger button (fixed position)
    {
      id: 'lichess-sidebar-trigger',
      route: ['game', 'analysis', 'home', 'unknown'],
      selector: 'body',
      position: 'append',
      component: LichessSidebarTrigger,
    },
    // Floating sidebar for all pages
    {
      id: 'lichess-floating-sidebar',
      route: ['game', 'analysis', 'home', 'unknown'],
      selector: 'body',
      position: 'append',
      component: FloatingSidebar,
    },
  ];
}
