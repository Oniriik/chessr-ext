import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useLinkedAccountsStore } from '../stores/linkedAccountsStore';
import type { PlatformProfile } from '../lib/platformApi';
import ChesscomIcon from './icons/ChesscomIcon';
import LichessIcon from './icons/LichessIcon';
import WorldchessIcon from './icons/WorldchessIcon';
import { useTranslation } from '../lib/i18n';
import './link-account-screen.css';

const platformIcons: Record<string, typeof ChesscomIcon> = {
  chesscom: ChesscomIcon,
  lichess: LichessIcon,
  worldchess: WorldchessIcon,
};

const platformLabels: Record<string, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  worldchess: 'World Chess',
};

export default function LinkAccountScreen({ profile }: { profile: PlatformProfile }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { linkAccount } = useLinkedAccountsStore();
  // Defensive fallback so an unknown platform doesn't crash the screen
  // (caused a React #418 on worldchess before WorldchessIcon was added).
  const Icon = platformIcons[profile.platform] ?? ChesscomIcon;
  const platformLabel = platformLabels[profile.platform] ?? profile.platform;

  const handleLink = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const result = await linkAccount(user.id, profile);
    setLoading(false);
    if (!result.success) {
      setError(result.error === 'ALREADY_LINKED'
        ? t('linkAccount.error.alreadyLinked')
        : result.error || t('linkAccount.error.generic'));
    }
  };

  const ratings = Object.entries(profile.ratings).filter(([, v]) => v);

  return (
    <div className="link-screen">
      <div className="link-screen-header">
        <span className="link-screen-eyebrow">{t('linkAccount.eyebrow')}</span>
        <h3 className="link-screen-title">{t('linkAccount.title', { platform: platformLabel })}</h3>
      </div>

      <div className="link-screen-card">
        <div className="link-screen-avatar-wrap">
          {profile.avatarUrl ? (
            <img className="link-screen-avatar" src={profile.avatarUrl} alt="" />
          ) : (
            <div className="link-screen-avatar link-screen-avatar--placeholder">
              {profile.username?.charAt(0)?.toUpperCase() ?? '?'}
            </div>
          )}
          <span className="link-screen-avatar-platform" title={platformLabel}>
            <Icon size={14} />
          </span>
        </div>
        <div className="link-screen-identity">
          <span className="link-screen-username">{profile.displayName ?? profile.username}</span>
          <span className="link-screen-platform">{platformLabel}</span>
        </div>
        {ratings.length > 0 && (
          <div className="link-screen-ratings">
            {ratings.map(([mode, rating]) => (
              <div key={mode} className="link-screen-rating">
                <span className="link-screen-rating-value">{rating}</span>
                <span className="link-screen-rating-mode">{mode}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="link-screen-error">{error}</p>}

      <button className="link-screen-btn" onClick={handleLink} disabled={loading}>
        {loading ? t('linkAccount.linking') : t('linkAccount.button', { platform: platformLabel })}
      </button>
    </div>
  );
}
