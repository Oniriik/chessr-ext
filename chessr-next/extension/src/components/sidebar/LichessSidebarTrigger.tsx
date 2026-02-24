import { useSidebar } from '../../hooks/useSidebar';

/**
 * Floating trigger button for Lichess.
 * Fixed position on the right side of the screen.
 */
export function LichessSidebarTrigger() {
  const { isOpen, toggle } = useSidebar();
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  // Hide trigger when sidebar is open
  if (isOpen) return null;

  return (
    <button
      onClick={toggle}
      className="tw-fixed tw-z-[9997] tw-flex tw-items-center tw-justify-center tw-rounded-l-xl tw-cursor-pointer"
      style={{
        right: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        width: '44px',
        height: '72px',
        background: 'linear-gradient(135deg, hsl(233,19%,12%) 0%, hsl(233,19%,8%) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRight: 'none',
      }}
      title="Open Chessr"
    >
      {/* Accent strip */}
      <div
        className="tw-absolute tw-left-0 tw-top-2 tw-bottom-2 tw-w-[2px] tw-rounded-full"
        style={{
          background: 'linear-gradient(180deg, rgba(139,92,246,0.8) 0%, rgba(59,130,246,0.6) 50%, rgba(139,92,246,0.8) 100%)',
          boxShadow: '0 0 8px rgba(139,92,246,0.5)',
        }}
      />
      <img
        src={logoUrl}
        alt="Chessr"
        className="tw-w-7 tw-h-7"
      />
    </button>
  );
}
