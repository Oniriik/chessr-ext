import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../lib/i18n';
import './auth-form.css';

const DISCORD_URL = 'https://discord.gg/72j4dUadTu';

type Mode = 'signin' | 'signup' | 'forgot';

export default function AuthForm() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { loading, error, signIn, signUp, resetPassword, clearError, bannedReason, appealUrl, clearBanned } = useAuthStore();
  const displayError = localError || error;
  const helpUrl = !bannedReason && error ? appealUrl : null;

  const switchMode = (next: Mode) => {
    setMode(next);
    setLocalError(null);
    clearError();
    clearBanned();
    setConfirmSent(false);
    setResetSent(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (mode === 'forgot') {
      const result = await resetPassword(email);
      if (result.success) setResetSent(true);
      else setLocalError(result.error ?? 'Password reset failed');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setLocalError(t('auth.passwordsNotMatch'));
      return;
    }

    if (mode === 'signin') {
      await signIn(email, password);
    } else {
      const result = await signUp(email, password);
      if (result.success) setConfirmSent(true);
    }
  };

  // Ban screen — blocks the form entirely until the user navigates
  // away or clicks "Try a different account" (which clears the flag
  // and exposes the form again). Shown both on banned-login and on
  // signup blocked because a linked account is banned.
  if (bannedReason) {
    return (
      <div className="auth-form">
        <img className="auth-logo" src={browser.runtime.getURL('/icons/chessr-logo.png')} alt="Chessr" />
        <h1 className="auth-title">
          <span className="auth-title-name">chessr</span>
          <span className="auth-title-dot">.io</span>
        </h1>
        <div className="auth-banned">
          <h3>{t('auth.banned.title')}</h3>
          <p className="auth-banned-reason">{bannedReason}</p>
          <p className="auth-banned-help">{t('auth.banned.help')}</p>
          <a
            className="auth-banned-cta"
            href={appealUrl ?? 'https://discord.gg/72j4dUadTu'}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('auth.banned.cta')}
          </a>
          <button className="auth-link" onClick={clearBanned}>
            {t('auth.banned.tryAnother')}
          </button>
        </div>
      </div>
    );
  }

  if (resetSent) {
    return (
      <div className="auth-form">
        <img className="auth-logo" src={browser.runtime.getURL('/icons/chessr-logo.png')} alt="Chessr" />
        <h1 className="auth-title">
          <span className="auth-title-name">chessr</span>
          <span className="auth-title-dot">.io</span>
        </h1>
        <div className="auth-success">
          <h3>{t('auth.reset.title')}</h3>
          <p>{t('auth.reset.body')} <strong>{email}</strong></p>
          <button className="auth-link" onClick={() => switchMode('signin')}>
            {t('auth.confirm.back')}
          </button>
        </div>
      </div>
    );
  }

  if (confirmSent) {
    return (
      <div className="auth-form">
        <img className="auth-logo" src={browser.runtime.getURL('/icons/chessr-logo.png')} alt="Chessr" />
        <h1 className="auth-title">
          <span className="auth-title-name">chessr</span>
          <span className="auth-title-dot">.io</span>
        </h1>
        <div className="auth-success">
          <h3>{t('auth.confirm.title')}</h3>
          <p>{t('auth.confirm.body')} <strong>{email}</strong></p>
          <button className="auth-link" onClick={() => { setConfirmSent(false); setMode('signin'); }}>
            {t('auth.confirm.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <img className="auth-logo" src={browser.runtime.getURL('/icons/chessr-logo.png')} alt="Chessr" />
      <h1 className="auth-title">
        <span className="auth-title-name">chessr</span>
        <span className="auth-title-dot">.io</span>
      </h1>
      <p className="auth-subtitle">
        {mode === 'signin' ? t('auth.title.signin') : mode === 'signup' ? t('auth.title.signup') : t('auth.title.forgot')}
      </p>

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder={t('auth.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        {mode !== 'forgot' && (
          <input
            type="password"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        )}
        {mode === 'signup' && (
          <input
            type="password"
            placeholder={t('auth.confirmPassword')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        )}

        {displayError && (
          <div className="auth-error-block">
            <p className="auth-error">{displayError}</p>
            {helpUrl && (
              <a
                className="auth-error-help"
                href={helpUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('auth.needHelp')}
              </a>
            )}
          </div>
        )}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? t('auth.loading') : mode === 'signin' ? t('auth.signIn') : mode === 'signup' ? t('auth.signUp') : t('auth.resetSend')}
        </button>
      </form>

      {mode === 'signin' && (
        <p className="auth-switch">
          <button className="auth-link" onClick={() => switchMode('forgot')}>
            {t('auth.forgotPassword')}
          </button>
        </p>
      )}

      <p className="auth-switch">
        {mode === 'forgot' ? (
          <button className="auth-link" onClick={() => switchMode('signin')}>
            {t('auth.confirm.back')}
          </button>
        ) : (
          <>
            {mode === 'signin' ? t('auth.switchToSignUp') : t('auth.switchToSignIn')}{' '}
            <button className="auth-link" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
              {mode === 'signin' ? t('auth.signUp') : t('auth.signIn')}
            </button>
          </>
        )}
      </p>

      <div className="auth-footer">
        <p>{t('auth.footer.community')}</p>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="auth-footer-btn auth-footer-discord">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          {t('auth.footer.discord')}
        </a>
      </div>
    </div>
  );
}
