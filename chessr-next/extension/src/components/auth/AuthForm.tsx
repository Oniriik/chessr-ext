import { useState } from 'react';
import { Mail, Lock, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

type AuthMode = 'login' | 'signup' | 'reset';

export function AuthForm() {
  const { signIn, signUp, resetPassword, resendConfirmationEmail, loading, error, clearError } = useAuthStore();
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
      setLocalError('Passwords do not match');
      return;
    }

    if (password.length < 6 && mode !== 'reset') {
      setLocalError('Password must be at least 6 characters');
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
        setSuccessMessage('Account created! Please check your email to verify your account.');
        setConfirmedEmail(email);
      }
    } else if (mode === 'reset') {
      const result = await resetPassword(email);
      if (result.success) {
        setSuccessMessage('Password reset email sent. Check your inbox.');
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
      setSuccessMessage('Confirmation email resent!');
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
    <div className="tw-h-full">
      <Card className="tw-p-4 tw-text-foreground tw-h-full">
        {/* Header */}
        <div className="tw-text-center tw-mb-4">
          <img
            src={chrome.runtime.getURL('icons/chessr-logo.png')}
            alt="Chessr"
            className="tw-w-16 tw-h-16 tw-mx-auto"
          />
          <h1 className="tw-text-2xl tw-font-bold tw-mb-3">Chessr.io</h1>
          <p className="tw-text-sm tw-text-muted-foreground">
            {mode === 'login'
              ? 'Sign in to your account'
              : mode === 'signup'
                ? 'Create a new account'
                : 'Reset your password'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="tw-space-y-3">
          {/* Email */}
          <div className="tw-space-y-1">
            <Label htmlFor="email" className="tw-text-xs tw-text-muted-foreground">
              Email
            </Label>
            <div className="tw-relative">
              <div className="tw-absolute tw-left-3 tw-top-0 tw-h-full tw-flex tw-items-center tw-pointer-events-none tw-z-10">
                <Mail className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
              </div>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="tw-pl-10"
              />
            </div>
          </div>

          {/* Password */}
          {mode !== 'reset' && (
            <div className="tw-space-y-1">
              <Label htmlFor="password" className="tw-text-xs tw-text-muted-foreground">
                Password
              </Label>
              <div className="tw-relative">
                <div className="tw-absolute tw-left-3 tw-top-0 tw-h-full tw-flex tw-items-center tw-pointer-events-none tw-z-10">
                  <Lock className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="tw-pl-10"
                />
              </div>
            </div>
          )}

          {/* Confirm Password (signup only) */}
          {mode === 'signup' && (
            <div className="tw-space-y-1">
              <Label htmlFor="confirmPassword" className="tw-text-xs tw-text-muted-foreground">
                Confirm Password
              </Label>
              <div className="tw-relative">
                <div className="tw-absolute tw-left-3 tw-top-0 tw-h-full tw-flex tw-items-center tw-pointer-events-none tw-z-10">
                  <Lock className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
                </div>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                  className="tw-pl-10"
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
              <div className="tw-font-semibold tw-mb-1">Verify your email</div>
              <div className="tw-opacity-80">We sent a confirmation email to:</div>
              <div className="tw-font-medium tw-mt-0.5 tw-mb-2">{confirmedEmail}</div>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handleResendEmail}
                disabled={resendingEmail}
                className="tw-h-auto tw-p-0 tw-text-xs"
              >
                {resendingEmail && <Loader2 className="tw-w-3 tw-h-3 tw-animate-spin" />}
                Resend email
              </Button>
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="tw-bg-success/20 tw-border tw-border-success/50 tw-text-success tw-text-xs tw-rounded-lg tw-p-3">
              {confirmedEmail && !needsEmailConfirmation ? (
                <>
                  <div className="tw-font-semibold tw-mb-1">Verify your email</div>
                  <div className="tw-text-success/80">We sent a confirmation email to:</div>
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
              'Sign In'
            ) : mode === 'signup' ? (
              'Sign Up'
            ) : (
              'Send Reset Email'
            )}
          </Button>
        </form>

        {/* Links */}
        <div className="tw-mt-4 tw-text-center tw-text-xs tw-space-y-2">
          {mode === 'login' && (
            <>
              <Button
                variant="link"
                size="sm"
                onClick={() => switchMode('reset')}
                className="tw-w-full tw-text-muted-foreground tw-h-auto tw-p-0"
              >
                Forgot password?
              </Button>
              <div className="tw-text-muted-foreground">
                Don't have an account?{' '}
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => switchMode('signup')}
                  className="tw-h-auto tw-p-0 tw-text-xs"
                >
                  Sign up
                </Button>
              </div>
            </>
          )}

          {mode === 'signup' && (
            <div className="tw-text-muted-foreground">
              Already have an account?{' '}
              <Button
                variant="link"
                size="sm"
                onClick={() => switchMode('login')}
                className="tw-h-auto tw-p-0 tw-text-xs"
              >
                Sign in
              </Button>
            </div>
          )}

          {mode === 'reset' && (
            <Button
              variant="link"
              size="sm"
              onClick={() => switchMode('login')}
              className="tw-w-full tw-text-muted-foreground hover:tw-text-foreground tw-h-auto tw-p-0"
            >
              <ArrowLeft className="tw-w-3 tw-h-3" /> Back to login
            </Button>
          )}
        </div>

      </Card>
    </div>
  );
}
