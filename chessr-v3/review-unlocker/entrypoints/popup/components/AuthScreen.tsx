import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthScreen() {
  const { signIn, signUp, resetPassword, loading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setInfo(null);
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfo(null);
    if (mode === 'signin') {
      await signIn(email.trim(), password);
    } else if (mode === 'signup') {
      const res = await signUp(email.trim(), password);
      if (res.success) {
        setInfo('Check your inbox to confirm your email, then sign in.');
        setMode('signin');
      }
    } else {
      const res = await resetPassword(email.trim());
      if (res.success) {
        setInfo('Password reset link sent. Check your inbox (and spam folder).');
        setMode('signin');
      }
    }
  };

  const title = mode === 'signin' ? 'Sign in'
    : mode === 'signup' ? 'Create your account'
    : 'Reset password';
  const submitLabel = mode === 'signin' ? 'Sign in'
    : mode === 'signup' ? 'Create account'
    : 'Send reset link';

  return (
    <div className="auth">
      <h1 className="auth-title">{title}</h1>
      <p className="auth-sub">
        {mode === 'reset'
          ? 'Enter your email — we’ll send you a link to reset your password.'
          : 'Unlock chess.com review with chessr.io'}
      </p>

      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          <span>Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </label>
        {mode !== 'reset' && (
          <label>
            <span>Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
        )}

        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}

        <button type="submit" className="review-cta" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? '…' : submitLabel}
        </button>
      </form>

      {/* Forgot-password link — only on the sign-in screen so we don't
       *  clutter the sign-up / reset views with a redundant CTA. */}
      {mode === 'signin' && (
        <div className="auth-forgot">
          <button className="link-btn" onClick={() => switchMode('reset')}>
            Forgot your password?
          </button>
        </div>
      )}

      <div className="auth-switch">
        {mode === 'signin' && (
          <>
            No account?{' '}
            <button className="link-btn" onClick={() => switchMode('signup')}>
              Create one
            </button>
          </>
        )}
        {mode === 'signup' && (
          <>
            Already registered?{' '}
            <button className="link-btn" onClick={() => switchMode('signin')}>
              Sign in
            </button>
          </>
        )}
        {mode === 'reset' && (
          <>
            Remembered it?{' '}
            <button className="link-btn" onClick={() => switchMode('signin')}>
              Back to sign in
            </button>
          </>
        )}
      </div>

      <div className="auth-foot">
        Uses your Chessr account. Same login as the main Chessr extension.
      </div>
    </div>
  );
}
