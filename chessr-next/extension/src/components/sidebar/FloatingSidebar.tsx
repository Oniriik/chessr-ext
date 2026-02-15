import { useSidebar } from '../../hooks/useSidebar';
import { SidebarContent } from './SidebarContent';

/**
 * Floating sidebar panel for unsupported pages.
 * Slides in from the right side of the screen.
 * Triggered by BaseSidebarTrigger in the navigation sidebar.
 */
export function FloatingSidebar() {
  const { isOpen, toggle } = useSidebar();
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  return (
    <>
      {/* Sidebar panel */}
      <div
        className="tw-fixed tw-top-0 tw-right-0 tw-h-full tw-z-[9998] tw-transition-transform tw-duration-300 tw-ease-out"
        style={{
          width: '320px',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        <div id="chessr-root" className="tw-h-full tw-bg-[hsl(233,19%,8%)] tw-border-l tw-border-white/10 tw-shadow-2xl">
          {/* Header with close button */}
          <div className="tw-flex tw-items-center tw-justify-between tw-p-4 tw-border-b tw-border-white/10">
            <div className="tw-flex tw-items-center tw-gap-3">
              <img src={logoUrl} alt="" className="tw-w-6 tw-h-6" />
              <span className="tw-text-white tw-font-semibold">Chessr</span>
            </div>
            <button
              onClick={toggle}
              className="tw-w-8 tw-h-8 tw-rounded-lg tw-bg-white/5 tw-border-none tw-cursor-pointer tw-flex tw-items-center tw-justify-center tw-text-white/60 hover:tw-bg-white/10 hover:tw-text-white tw-transition-colors"
              title="Fermer Chessr"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Sidebar content */}
          <div className="tw-h-[calc(100%-65px)] tw-overflow-auto">
            <SidebarContent />
          </div>
        </div>
      </div>

    </>
  );
}
