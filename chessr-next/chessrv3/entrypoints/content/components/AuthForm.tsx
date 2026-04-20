import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../stores/authStore';
import './auth-form.css';

const DISCORD_URL = 'https://discord.gg/72j4dUadTu';

type Mode = 'signin' | 'signup';

export default function AuthForm() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { loading, error, signIn, signUp, clearError } = useAuthStore();

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setLocalError(null);
    clearError();
    setConfirmSent(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setLocalError('Passwords do not match');
      return;
    }

    if (mode === 'signin') {
      await signIn(email, password);
    } else {
      const result = await signUp(email, password);
      if (result.success) setConfirmSent(true);
    }
  };

  const displayError = localError || error;

  if (confirmSent) {
    return (
      <div className="auth-form">
        <img className="auth-logo" src={browser.runtime.getURL('/icons/chessr-logo.png')} alt="Chessr" />
        <h1 className="auth-title">
          <span className="auth-title-name">chessr</span>
          <span className="auth-title-dot">.io</span>
        </h1>
        <div className="auth-success">
          <h3>Verify your email</h3>
          <p>We sent a confirmation link to <strong>{email}</strong></p>
          <button className="auth-link" onClick={() => { setConfirmSent(false); setMode('signin'); }}>
            Back to sign in
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
        {mode === 'signin' ? 'Sign in to your account' : 'Create a new account'}
      </p>

      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        />
        {mode === 'signup' && (
          <input
            type="password"
            placeholder="Confirm password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
          />
        )}

        {displayError && <p className="auth-error">{displayError}</p>}

        <button type="submit" className="auth-submit" disabled={loading}>
          {loading ? 'Loading...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
        </button>
      </form>

      <p className="auth-switch">
        {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
        <button className="auth-link" onClick={switchMode}>
          {mode === 'signin' ? 'Sign up' : 'Sign in'}
        </button>
      </p>

      <div className="auth-footer">
        <p>Join our community for tips, updates & support</p>
        <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="auth-footer-btn auth-footer-discord">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          Join Discord server
        </a>
      </div>
    </div>
  );
}
