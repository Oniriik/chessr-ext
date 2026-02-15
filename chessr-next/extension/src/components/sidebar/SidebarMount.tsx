import { SidebarTrigger } from './SidebarTrigger';
import { SidebarPortal } from './SidebarPortal';

interface SidebarMountProps {
  /** Selector of the original sidebar to replace */
  originalSidebarSelector: string;
  /** Class to inherit from the original sidebar for styling */
  inheritClass?: string;
}

/**
 * Mount component that renders both the trigger button and the sidebar portal.
 * The trigger is rendered in place, the sidebar is portaled to replace the original.
 */
export function SidebarMount({ originalSidebarSelector, inheritClass }: SidebarMountProps) {
  return (
    <>
      <SidebarTrigger />
      <SidebarPortal
        originalSidebarSelector={originalSidebarSelector}
        inheritClass={inheritClass}
      />
    </>
  );
}
