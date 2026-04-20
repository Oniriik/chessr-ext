import { useAuthStore, type Plan } from '../stores/authStore';
import { useLayoutStore } from '../stores/layoutStore';
import './panel-header.css';

// Tinted header pill — bg is the accent color at 18% alpha, text is the accent color at full saturation.
const planConfig: Record<Plan, { label: string; bg: string; color: string }> = {
  lifetime:  { label: 'Lifetime',   bg: 'rgba(192, 132, 252, 0.18)', color: '#c084fc' },
  beta:      { label: 'Beta',       bg: 'rgba(165, 180, 252, 0.18)', color: '#a5b4fc' },
  premium:   { label: 'Premium',    bg: 'rgba(96, 165, 250, 0.18)',  color: '#60a5fa' },
  freetrial: { label: 'Free trial', bg: 'rgba(248, 113, 113, 0.18)', color: '#f87171' },
  free:      { label: 'Free',       bg: 'rgba(251, 191, 36, 0.18)',  color: '#fbbf24' },
};

interface PanelHeaderProps {
  showSettings: boolean;
  onToggleSettings: () => void;
  hideActions?: boolean;
}

export default function PanelHeader({ showSettings, onToggleSettings, hideActions }: PanelHeaderProps) {
  const { plan, planLoading, signOut } = useAuthStore();
  const { editMode, setEditMode } = useLayoutStore();
  const config = planConfig[plan];

  return (
    <div className="panel-header">
      <div className="panel-header-left">
        {showSettings ? (
          <>
            <button className="panel-header-btn" onClick={onToggleSettings} title="Back">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="panel-header-title">Settings</span>
          </>
        ) : (
          <>
            <span className="panel-header-title">chessr<span className="panel-header-title-dot">.io</span></span>
            {planLoading ? (
              <span className="plan-badge-skeleton" />
            ) : plan === 'free' ? (
              <button className="plan-badge-upgrade">Upgrade</button>
            ) : (
              <span className="plan-badge" style={{ background: config.bg, color: config.color }}>
                {config.label}
              </span>
            )}
          </>
        )}
      </div>
      <div className="panel-header-right">
        {!hideActions && !showSettings && (
          <button
            className={`panel-header-btn ${editMode ? 'panel-header-btn--active' : ''}`}
            onClick={() => setEditMode(!editMode)}
            title={editMode ? 'Done editing' : 'Edit layout'}
          >
            {editMode ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            )}
          </button>
        )}
        {!hideActions && !showSettings && (
          <button className="panel-header-btn" onClick={onToggleSettings} title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
        <button className="panel-header-btn" onClick={signOut} title="Sign out">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
