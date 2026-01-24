import { useState } from 'react';
import { LogIn, UserPlus, Mail, Lock, ArrowLeft, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { Button } from './ui/button';
import { Card } from './ui/card';

type AuthMode = 'login' | 'signup' | 'reset';

export function AuthForm() {
  const { signIn, signUp, resetPassword, loading, error, clearError } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSuccessMessage(null);
    clearError();

    if (mode === 'signup' && password !== confirmPassword) {
      setLocalError('Les mots de passe ne correspondent pas');
      return;
    }

    if (password.length < 6 && mode !== 'reset') {
      setLocalError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    if (mode === 'login') {
      await signIn(email, password);
    } else if (mode === 'signup') {
      const result = await signUp(email, password);
      if (result.success) {
        setSuccessMessage('Compte créé ! Vérifiez votre email pour confirmer.');
      }
    } else if (mode === 'reset') {
      const result = await resetPassword(email);
      if (result.success) {
        setSuccessMessage('Email de réinitialisation envoyé !');
      }
    }
  };

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode);
    setLocalError(null);
    setSuccessMessage(null);
    clearError();
  };

  const displayError = localError || error;

  return (
    <div className="tw-p-4">
      <Card className="tw-p-4">
        {/* Header */}
        <div className="tw-text-center tw-mb-4">
          <div className="tw-w-12 tw-h-12 tw-bg-primary/20 tw-rounded-full tw-flex tw-items-center tw-justify-center tw-mx-auto tw-mb-3">
            {mode === 'login' ? (
              <LogIn className="tw-w-6 tw-h-6 tw-text-primary" />
            ) : mode === 'signup' ? (
              <UserPlus className="tw-w-6 tw-h-6 tw-text-primary" />
            ) : (
              <Mail className="tw-w-6 tw-h-6 tw-text-primary" />
            )}
          </div>
          <h2 className="tw-text-lg tw-font-semibold">
            {mode === 'login' ? 'Connexion' : mode === 'signup' ? 'Inscription' : 'Mot de passe oublié'}
          </h2>
          <p className="tw-text-xs tw-text-muted tw-mt-1">
            {mode === 'login'
              ? 'Connectez-vous pour accéder à Chessr'
              : mode === 'signup'
                ? 'Créez un compte pour commencer'
                : 'Entrez votre email pour réinitialiser'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="tw-space-y-3">
          {/* Email */}
          <div>
            <label className="tw-text-xs tw-text-muted tw-block tw-mb-1">Email</label>
            <div className="tw-relative">
              <Mail className="tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-muted" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemple.com"
                required
                className="tw-w-full tw-bg-background tw-border tw-border-gray-700 tw-rounded-lg tw-py-2 tw-pl-10 tw-pr-3 tw-text-sm focus:tw-outline-none focus:tw-border-primary"
              />
            </div>
          </div>

          {/* Password */}
          {mode !== 'reset' && (
            <div>
              <label className="tw-text-xs tw-text-muted tw-block tw-mb-1">Mot de passe</label>
              <div className="tw-relative">
                <Lock className="tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-muted" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="tw-w-full tw-bg-background tw-border tw-border-gray-700 tw-rounded-lg tw-py-2 tw-pl-10 tw-pr-3 tw-text-sm focus:tw-outline-none focus:tw-border-primary"
                />
              </div>
            </div>
          )}

          {/* Confirm Password (signup only) */}
          {mode === 'signup' && (
            <div>
              <label className="tw-text-xs tw-text-muted tw-block tw-mb-1">Confirmer le mot de passe</label>
              <div className="tw-relative">
                <Lock className="tw-absolute tw-left-3 tw-top-1/2 -tw-translate-y-1/2 tw-w-4 tw-h-4 tw-text-muted" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="tw-w-full tw-bg-background tw-border tw-border-gray-700 tw-rounded-lg tw-py-2 tw-pl-10 tw-pr-3 tw-text-sm focus:tw-outline-none focus:tw-border-primary"
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {displayError && (
            <div className="tw-bg-danger/20 tw-border tw-border-danger/50 tw-text-danger tw-text-xs tw-rounded-lg tw-p-2">
              {displayError}
            </div>
          )}

          {/* Success message */}
          {successMessage && (
            <div className="tw-bg-success/20 tw-border tw-border-success/50 tw-text-success tw-text-xs tw-rounded-lg tw-p-2">
              {successMessage}
            </div>
          )}

          {/* Submit button */}
          <Button type="submit" className="tw-w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin" />
            ) : mode === 'login' ? (
              'Se connecter'
            ) : mode === 'signup' ? (
              "S'inscrire"
            ) : (
              'Envoyer le lien'
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
                Mot de passe oublié ?
              </button>
              <div className="tw-text-muted">
                Pas de compte ?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="tw-text-primary hover:tw-underline"
                >
                  S'inscrire
                </button>
              </div>
            </>
          )}

          {mode === 'signup' && (
            <div className="tw-text-muted">
              Déjà un compte ?{' '}
              <button
                onClick={() => switchMode('login')}
                className="tw-text-primary hover:tw-underline"
              >
                Se connecter
              </button>
            </div>
          )}

          {mode === 'reset' && (
            <button
              onClick={() => switchMode('login')}
              className="tw-text-muted hover:tw-text-foreground tw-flex tw-items-center tw-justify-center tw-gap-1 tw-w-full"
            >
              <ArrowLeft className="tw-w-3 tw-h-3" /> Retour à la connexion
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
