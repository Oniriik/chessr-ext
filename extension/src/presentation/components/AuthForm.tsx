import { useState } from 'react';
import { Mail, Lock, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { useTranslation } from '../../i18n';
import { Button } from './ui/button';
import { Card } from './ui/card';

type AuthMode = 'login' | 'signup' | 'reset';

export function AuthForm() {
  const { signIn, signUp, resetPassword, resendConfirmationEmail, loading, error, clearError } = useAuthStore();
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);
    setConfirmedEmail(null);
    setNeedsEmailConfirmation(false);
    clearError();

    if (mode === 'signup' && password !== confirmPassword) {
      setLocalError(t.auth.passwordMismatch);
      return;
    }

    if (password.length < 6 && mode !== 'reset') {
      setLocalError(t.auth.passwordTooShort);
      return;
    }

    if (mode === 'login') {
      const result = await signIn(email, password);
      // Check if error is about email not confirmed
      if (!result.success && result.error?.toLowerCase().includes('email not confirmed')) {
        setNeedsEmailConfirmation(true);
        setConfirmedEmail(email);
        clearError();
      }
    } else if (mode === 'signup') {
      const result = await signUp(email, password);
      if (result.success) {
        setSuccessMessage(t.auth.accountCreated);
        setConfirmedEmail(email);
      }
    } else if (mode === 'reset') {
      const result = await resetPassword(email);
      if (result.success) {
        setSuccessMessage(t.auth.resetEmailSent);
      }
    }
  };

  const handleResendEmail = async () => {
    if (!confirmedEmail || resendingEmail) return;
    setResendingEmail(true);
    const result = await resendConfirmationEmail(confirmedEmail);
    setResendingEmail(false);
    if (result.success) {
      setNeedsEmailConfirmation(false);
      setSuccessMessage(t.auth.emailResent);
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setLocalError(null);
    setSuccessMessage(null);
    setConfirmedEmail(null);
    setNeedsEmailConfirmation(false);
    setResendingEmail(false);
    clearError();
  };

  const displayError = localError || error;

  return (
    <div className="tw-p-4">
      <Card className="tw-p-4 tw-text-foreground">
        {/* Header */}
        <div className="tw-text-center tw-mb-4">
          <img
            src={chrome.runtime.getURL('icons/chessr-logo.png')}
            alt="Chessr"
            className="tw-w-16 tw-h-16 tw-mx-auto tw-mb-3"
          />
          <p className="tw-text-sm tw-text-muted">
            {mode === 'login'
              ? t.auth.loginSubtitle
              : mode === 'signup'
                ? t.auth.signupSubtitle
                : t.auth.resetSubtitle}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="tw-space-y-3">
          {/* Email */}
          <div>
            <label className="tw-text-xs tw-text-muted tw-block tw-mb-1">{t.auth.email}</label>
            <div className="tw-relative">
              <Mail className="tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-muted" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.auth.emailPlaceholder}
                required
                className="tw-w-full tw-bg-background tw-border tw-border-border tw-rounded-lg tw-py-2 tw-pl-10 tw-pr-3 tw-text-sm focus:tw-outline-none focus:tw-border-primary"
              />
            </div>
          </div>

          {/* Password */}
          {mode !== 'reset' && (
            <div>
              <label className="tw-text-xs tw-text-muted tw-block tw-mb-1">{t.auth.password}</label>
              <div className="tw-relative">
                <Lock className="tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-muted" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.passwordPlaceholder}
                  required
                  className="tw-w-full tw-bg-background tw-border tw-border-border tw-rounded-lg tw-py-2 tw-pl-10 tw-pr-3 tw-text-sm focus:tw-outline-none focus:tw-border-primary"
                />
              </div>
            </div>
          )}

          {/* Confirm Password (signup only) */}
          {mode === 'signup' && (
            <div>
              <label className="tw-text-xs tw-text-muted tw-block tw-mb-1">{t.auth.confirmPassword}</label>
              <div className="tw-relative">
                <Lock className="tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-muted" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t.auth.passwordPlaceholder}
                  required
                  className="tw-w-full tw-bg-background tw-border tw-border-border tw-rounded-lg tw-py-2 tw-pl-10 tw-pr-3 tw-text-sm focus:tw-outline-none focus:tw-border-primary"
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {displayError && !needsEmailConfirmation && (
            <div className="tw-bg-danger/20 tw-border tw-border-danger/50 tw-text-danger tw-text-xs tw-rounded-lg tw-p-2">
              {displayError}
            </div>
          )}

          {/* Email confirmation needed */}
          {needsEmailConfirmation && confirmedEmail && (
            <div className="tw-bg-warning/20 tw-border tw-border-warning/50 tw-text-warning tw-text-xs tw-rounded-lg tw-p-3">
              <div className="tw-font-semibold tw-mb-1">{t.auth.verifyYourEmail}</div>
              <div className="tw-opacity-80">{t.auth.emailSentTo}</div>
              <div className="tw-font-medium tw-mt-0.5 tw-mb-2">{confirmedEmail}</div>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={resendingEmail}
                className="tw-text-xs tw-text-primary hover:tw-underline tw-inline-flex tw-items-center tw-gap-1"
              >
                {resendingEmail && <Loader2 className="tw-w-3 tw-h-3 tw-animate-spin" />}
                {t.auth.resendEmail}
              </button>
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="tw-bg-success/20 tw-border tw-border-success/50 tw-text-success tw-text-xs tw-rounded-lg tw-p-3">
              {confirmedEmail && !needsEmailConfirmation ? (
                <>
                  <div className="tw-font-semibold tw-mb-1">{t.auth.verifyYourEmail}</div>
                  <div className="tw-text-success/80">{t.auth.emailSentTo}</div>
                  <div className="tw-font-medium tw-mt-0.5">{confirmedEmail}</div>
                </>
              ) : (
                successMessage
              )}
            </div>
          )}

          {/* Submit button */}
          <Button type="submit" className="tw-w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin" />
            ) : mode === 'login' ? (
              t.auth.loginButton
            ) : mode === 'signup' ? (
              t.auth.signupButton
            ) : (
              t.auth.resetButton
            )}
          </Button>
        </form>

        {/* Links */}
        <div className="tw-mt-4 tw-text-center tw-text-xs tw-space-y-2">
          {mode === 'login' && (
            <>
              <button
                onClick={() => switchMode('reset')}
                className="tw-text-muted hover:tw-text-foreground tw-block tw-w-full"
              >
                {t.auth.forgotPasswordLink}
              </button>
              <div className="tw-text-muted">
                {t.auth.noAccount}{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="tw-text-primary hover:tw-underline"
                >
                  {t.auth.signupLink}
                </button>
              </div>
            </>
          )}

          {mode === 'signup' && (
            <div className="tw-text-muted">
              {t.auth.hasAccount}{' '}
              <button
                onClick={() => switchMode('login')}
                className="tw-text-primary hover:tw-underline"
              >
                {t.auth.loginLink}
              </button>
            </div>
          )}

          {mode === 'reset' && (
            <button
              onClick={() => switchMode('login')}
              className="tw-text-muted hover:tw-text-foreground tw-flex tw-items-center tw-justify-center tw-gap-1 tw-w-full"
            >
              <ArrowLeft className="tw-w-3 tw-h-3" /> {t.auth.backToLogin}
            </button>
          )}
        </div>

      </Card>
    </div>
  );
}
