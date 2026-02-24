import { useSidebar } from '../../hooks/useSidebar';
import { SidebarContent } from './SidebarContent';

/**
 * Floating sidebar panel for unsupported pages.
 * Slides in from the right side of the screen.
 * Triggered by BaseSidebarTrigger in the navigation sidebar.
 */
export function FloatingSidebar() {
  const { isOpen } = useSidebar();

  return (
    <div
      className="tw-fixed tw-top-0 tw-right-0 tw-h-full tw-z-[9998] tw-transition-transform tw-duration-300 tw-ease-out"
      style={{
        width: '370px',
        transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      <div id="chessr-root" className="tw-w-full tw-h-full tw-box-border tw-relative tw-bg-[hsl(233,19%,8%)] tw-border-l tw-border-white/10 tw-shadow-2xl tw-overflow-y-auto tw-overflow-x-hidden">
        <SidebarContent />
      </div>
    </div>
  );
}
