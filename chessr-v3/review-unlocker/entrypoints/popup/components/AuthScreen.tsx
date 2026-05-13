import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

type Mode = 'signin' | 'signup';

export default function AuthScreen() {
  const { signIn, signUp, loading, error, clearError } = useAuthStore();
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
    } else {
      const res = await signUp(email.trim(), password);
      if (res.success) {
        setInfo('Check your inbox to confirm your email, then sign in.');
        setMode('signin');
      }
    }
  };

  return (
    <div className="auth">
      <h1 className="auth-title">
        {mode === 'signin' ? 'Sign in' : 'Create your account'}
      </h1>
      <p className="auth-sub">
        Unlock chess.com review with chessr.io
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

        {error && <div className="auth-error">{error}</div>}
        {info && <div className="auth-info">{info}</div>}

        <button type="submit" className="review-cta" disabled={loading} style={{ marginTop: 4 }}>
          {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <div className="auth-switch">
        {mode === 'signin' ? (
          <>
            No account?{' '}
            <button className="link-btn" onClick={() => switchMode('signup')}>
              Create one
            </button>
          </>
        ) : (
          <>
            Already registered?{' '}
            <button className="link-btn" onClick={() => switchMode('signin')}>
              Sign in
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
