import { useSidebar } from '../../hooks/useSidebar';

/**
 * Trigger button styled to match chess.com base-sidebar navigation.
 * Uses native chess.com classes for seamless integration.
 */
export function BaseSidebarTrigger() {
  const { isOpen, toggle } = useSidebar();
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  return (
    <a
      onClick={(e) => {
        e.preventDefault();
        toggle();
      }}
      href="#"
      className="sidebar-link cc-button-component"
      title={isOpen ? 'Masquer Chessr' : 'Afficher Chessr'}
      style={{
        cursor: 'pointer',
      }}
    >
      <div className="cc-avatar-component cc-avatar-size-24">
        <img
          className="cc-avatar-img"
          src={logoUrl}
          alt="Chessr"
          height="24"
          width="24"
        />
      </div>

      <h2
        className="sidebar-link-text cc-text-medium-bold"
        style={{
          color: isOpen ? '#4a90d9' : undefined,
          flex: 1,
        }}
      >
        Chessr
      </h2>

      {isOpen && (
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#4a90d9',
            marginLeft: 'auto',
          }}
        />
      )}
    </a>
  );
}
