import { useSidebar } from '../../hooks/useSidebar';

export function SidebarTrigger() {
  const { isOpen, toggle } = useSidebar();
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  return (
    <button
      onClick={toggle}
      className={`
        tw-group tw-relative tw-flex tw-items-center tw-justify-center
        tw-w-10 tw-h-10 tw-rounded-xl tw-border tw-border-white/10
        tw-transition-all tw-duration-300 tw-ease-out tw-pointer-events-auto
        tw-backdrop-blur-sm
        ${isOpen
          ? 'tw-bg-chessr/90 tw-shadow-lg tw-shadow-chessr/30 tw-scale-105'
          : 'tw-bg-zinc-800/80 hover:tw-bg-zinc-700/90 hover:tw-scale-105 hover:tw-shadow-lg hover:tw-shadow-black/20'
        }
      `}
      title={isOpen ? 'Masquer Chessr' : 'Afficher Chessr'}
    >
      {/* Glow effect when active */}
      {isOpen && (
        <span className="tw-absolute tw-inset-0 tw-rounded-xl tw-bg-chessr-light/20 tw-animate-pulse" />
      )}

      {/* Logo */}
      <img
        src={logoUrl}
        alt="Chessr"
        className={`
          tw-w-6 tw-h-6 tw-relative tw-z-10
          tw-transition-transform tw-duration-300 tw-ease-out
          ${!isOpen && 'group-hover:tw-scale-110'}
        `}
      />
    </button>
  );
}
