import { useState } from 'react';
import { Mail, Lock, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const DISCORD_URL = 'https://discord.gg/72j4dUadTu';

type AuthMode = 'login' | 'signup' | 'reset';

// Discord icon SVG
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

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
      <Card className="tw-h-full tw-flex tw-flex-col tw-overflow-hidden">
        {/* Header with gradient background - blue fading to card background */}
        <div className="tw-bg-gradient-to-b tw-from-blue-500/20 tw-to-transparent tw-p-6 tw-text-center">
          <img
            src={chrome.runtime.getURL('icons/chessr-logo.png')}
            alt="Chessr"
            className="tw-w-20 tw-h-20 tw-mx-auto tw-mb-2"
          />
          <h1 className="tw-text-2xl tw-font-bold tw-tracking-tight tw-mb-1">
            <span className="tw-text-foreground">chessr</span>
            <span className="tw-text-secondary">.io</span>
          </h1>
          <p className="tw-text-xs tw-text-muted-foreground">
            {mode === 'login'
              ? 'Sign in to your account'
              : mode === 'signup'
                ? 'Create a new account'
                : 'Reset your password'}
          </p>
        </div>

        {/* Form */}
        <div className="tw-p-4 tw-flex-1">
          <form onSubmit={handleSubmit} className="tw-space-y-3">
            {/* Email */}
            <div className="tw-space-y-1.5">
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
                  className="tw-pl-10 tw-bg-muted/30 focus:tw-bg-muted/50"
                />
              </div>
            </div>

            {/* Password */}
            {mode !== 'reset' && (
              <div className="tw-space-y-1.5">
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
                    className="tw-pl-10 tw-bg-muted/30 focus:tw-bg-muted/50"
                  />
                </div>
              </div>
            )}

            {/* Confirm Password (signup only) */}
            {mode === 'signup' && (
              <div className="tw-space-y-1.5">
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
                    className="tw-pl-10 tw-bg-muted/30 focus:tw-bg-muted/50"
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {displayError && !needsEmailConfirmation && (
              <div className="tw-bg-destructive/10 tw-border tw-border-destructive/30 tw-text-destructive tw-text-xs tw-rounded-lg tw-p-3">
                {displayError}
              </div>
            )}

            {/* Email confirmation needed */}
            {needsEmailConfirmation && confirmedEmail && (
              <div className="tw-bg-warning/10 tw-border tw-border-warning/30 tw-text-warning tw-text-xs tw-rounded-lg tw-p-3">
                <div className="tw-font-semibold tw-mb-1">Verify your email</div>
                <div className="tw-opacity-80">We sent a confirmation email to:</div>
                <div className="tw-font-medium tw-mt-0.5 tw-mb-2">{confirmedEmail}</div>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={handleResendEmail}
                  disabled={resendingEmail}
                  className="tw-h-auto tw-p-0 tw-text-xs tw-text-warning hover:tw-text-warning/80"
                >
                  {resendingEmail && <Loader2 className="tw-w-3 tw-h-3 tw-animate-spin tw-mr-1" />}
                  Resend email
                </Button>
              </div>
            )}

            {/* Success message */}
            {successMessage && (
              <div className="tw-bg-success/10 tw-border tw-border-success/30 tw-text-success tw-text-xs tw-rounded-lg tw-p-3">
                {confirmedEmail && !needsEmailConfirmation ? (
                  <>
                    <div className="tw-font-semibold tw-mb-1">Verify your email</div>
                    <div className="tw-opacity-80">We sent a confirmation email to:</div>
                    <div className="tw-font-medium tw-mt-0.5">{confirmedEmail}</div>
                  </>
                ) : (
                  successMessage
                )}
              </div>
            )}

            {/* Submit button */}
            <Button
              type="submit"
              className="tw-w-full tw-bg-gradient-to-r tw-from-primary tw-to-secondary hover:tw-opacity-90 tw-transition-opacity"
              disabled={loading}
            >
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
                  className="tw-w-full tw-text-muted-foreground hover:tw-text-foreground tw-h-auto tw-p-0"
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
                <ArrowLeft className="tw-w-3 tw-h-3 tw-mr-1" /> Back to login
              </Button>
            )}
          </div>
        </div>

        {/* Links section */}
        <div className="tw-p-4 tw-pt-0 tw-mt-auto">
          <div className="tw-border-t tw-border-border/50 tw-pt-4 tw-space-y-2">
            <div className="tw-flex tw-gap-2">
              <a
                href="https://chessr.io"
                target="_blank"
                rel="noopener noreferrer"
                className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-flex-1 tw-py-2.5 tw-px-4 tw-rounded-lg tw-bg-primary/10 hover:tw-bg-primary/20 tw-text-primary tw-text-sm tw-font-medium tw-transition-colors"
              >
                <svg className="tw-w-4 tw-h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                Website
              </a>
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="tw-flex tw-items-center tw-justify-center tw-gap-2 tw-flex-1 tw-py-2.5 tw-px-4 tw-rounded-lg tw-bg-[#5865F2]/10 hover:tw-bg-[#5865F2]/20 tw-text-[#5865F2] tw-text-sm tw-font-medium tw-transition-colors"
              >
                <DiscordIcon className="tw-w-4 tw-h-4" />
                Discord
              </a>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
