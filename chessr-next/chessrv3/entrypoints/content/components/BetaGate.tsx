import { useAuthStore } from '../stores/authStore';

export default function BetaGate() {
  const { user, plan, signOut } = useAuthStore();
  return (
    <div className="beta-gate">
      <div className="beta-gate-icon">🔒</div>
      <h2 className="beta-gate-title">Chessr is in beta</h2>
      <p className="beta-gate-body">
        Only premium members can use Chessr during the beta period.
      </p>
      <div className="beta-gate-user">
        <span className="beta-gate-user-label">Signed in as</span>
        <span className="beta-gate-user-email">{user?.email || '—'}</span>
        <span className="beta-gate-user-plan">{plan || 'free'}</span>
      </div>
      <a className="beta-gate-cta" href="https://chessr.io/#pricing" target="_blank" rel="noopener noreferrer">
        Upgrade to Premium
      </a>
      <button className="beta-gate-signout" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}
