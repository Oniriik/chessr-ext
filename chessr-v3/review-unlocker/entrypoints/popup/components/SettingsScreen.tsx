import { useAuthStore, type Plan } from '../stores/authStore';
import { openBillingPage } from '../lib/openBilling';

interface Props {
  onBack: () => void;
}

/** Plan presentation — same labels/colors as chessr-v3 SettingsScreen so
 *  users moving between the two extensions see consistent badges. */
const PLAN_CONFIG: Record<Plan, { label: string; bg: string; color: string; cta: string | null }> = {
  lifetime:  { label: 'Lifetime',   bg: '#8263F1', color: '#3F2F7A', cta: null },
  beta:      { label: 'Beta',       bg: '#6366f1', color: '#252972', cta: null },
  premium:   { label: 'Premium',    bg: '#60a5fa', color: '#264A70', cta: 'Manage subscription' },
  unlocker:  { label: 'Unlocker',   bg: '#22d3ee', color: '#0E4A5C', cta: 'Manage subscription' },
  freetrial: { label: 'Free trial', bg: '#9c4040', color: '#481A1A', cta: 'Upgrade to Premium' },
  free:      { label: 'Free',       bg: '#EAB308', color: '#574407', cta: 'Upgrade to Premium' },
};

export default function SettingsScreen({ onBack }: Props) {
  const { user, plan } = useAuthStore();
  const config = PLAN_CONFIG[plan];

  return (
    <div className="settings-section">
      <button className="settings-back" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        Back
      </button>

      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">Connected as</span>
          {user?.email_confirmed_at ? (
            <span className="settings-verified">Verified</span>
          ) : (
            <span className="settings-unverified">Unverified</span>
          )}
        </div>
        <div className="settings-account-email">{user?.email || '—'}</div>
        {user?.created_at && (
          <div className="settings-account-joined">
            Joined {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
        )}
      </div>

      <div className="settings-plan-card">
        <div className="settings-plan-row">
          <span className="settings-label">Plan</span>
          <span className="settings-plan-badge" style={{ background: config.bg, color: config.color }}>
            {config.label}
          </span>
        </div>
        {config.cta && (
          <button className="settings-plan-cta" onClick={() => openBillingPage()}>
            {config.cta}
          </button>
        )}
      </div>

      <a className="settings-foot-link" href="https://chessr.io" target="_blank" rel="noreferrer">
        Get the full Chessr extension →
      </a>
    </div>
  );
}
