import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../lib/i18n';

export default function BetaGate() {
  const { t } = useTranslation();
  const { user, plan, signOut } = useAuthStore();
  return (
    <div className="beta-gate">
      <div className="beta-gate-icon">🔒</div>
      <h2 className="beta-gate-title">{t('betaGate.title')}</h2>
      <p className="beta-gate-body">{t('betaGate.body')}</p>
      <div className="beta-gate-user">
        <span className="beta-gate-user-label">{t('betaGate.signedIn')}</span>
        <span className="beta-gate-user-email">{user?.email || '—'}</span>
        <span className="beta-gate-user-plan">{plan || 'free'}</span>
      </div>
      <a className="beta-gate-cta" href="https://chessr.io/#pricing" target="_blank" rel="noopener noreferrer">
        {t('betaGate.cta')}
      </a>
      <button className="beta-gate-signout" onClick={signOut}>
        {t('betaGate.signOut')}
      </button>
    </div>
  );
}
