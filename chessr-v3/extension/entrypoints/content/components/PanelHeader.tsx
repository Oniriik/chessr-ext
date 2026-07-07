import { useAuthStore, type Plan } from '../stores/authStore';
import { useLayoutStore } from '../stores/layoutStore';
import { useTrialModalStore } from '../stores/trialModalStore';
import { openBillingPage } from '../lib/openBilling';
import { canOfferTrial } from '../lib/premium';
import { useTranslation } from '../lib/i18n';
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
  const { t } = useTranslation();
  const { plan, planLoading, freetrialUsed, signOut } = useAuthStore();
  const { editMode, setEditMode } = useLayoutStore();
  const openTrialModal = useTrialModalStore((s) => s.open);
  const trialOffer = canOfferTrial(plan, freetrialUsed, planLoading);
  const config = planConfig[plan];

  return (
    <div className="panel-header">
      <div className="panel-header-left">
        {showSettings ? (
          <>
            <button className="panel-header-btn" onClick={onToggleSettings} data-tooltip={t('panel.title.back')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="panel-header-title">{t('panel.title.settings')}</span>
          </>
        ) : (
          <>
            <span className="panel-header-title">chessr<span className="panel-header-title-dot">.io</span></span>
            {planLoading ? (
              <span className="plan-badge-skeleton" />
            ) : plan === 'free' ? (
              // Same "Upgrade" pill as always — but while the free trial is
              // still claimable it opens the trial modal instead of the
              // checkout (the modal keeps a direct "upgrade now" link).
              <button
                className="plan-badge-upgrade"
                onClick={() => trialOffer ? openTrialModal('panel-header') : openBillingPage()}
              >
                {t('panel.upgrade')}
              </button>
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
            className="panel-header-btn"
            onClick={() => window.open('https://app.chessr.io/profile-analysis', '_blank', 'noopener,noreferrer')}
            data-tooltip={t('panel.profileAnalysis')}
            disabled={editMode}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </button>
        )}
        {!hideActions && !showSettings && (
          <button
            className={`panel-header-btn ${editMode ? 'panel-header-btn--active' : ''}`}
            onClick={() => setEditMode(!editMode)}
            data-tooltip={editMode ? t('panel.edit.done') : t('panel.edit.layout')}
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
          <button className="panel-header-btn" onClick={onToggleSettings} data-tooltip={t('panel.settings')} disabled={editMode}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        )}
        <button className="panel-header-btn" onClick={signOut} data-tooltip={t('common.signOut')} disabled={editMode}>
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
