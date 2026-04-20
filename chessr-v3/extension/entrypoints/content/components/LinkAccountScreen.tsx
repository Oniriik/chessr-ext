import { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useLinkedAccountsStore } from '../stores/linkedAccountsStore';
import type { PlatformProfile } from '../lib/platformApi';
import ChesscomIcon from './icons/ChesscomIcon';
import LichessIcon from './icons/LichessIcon';
import './link-account-screen.css';

const platformIcons: Record<string, typeof ChesscomIcon> = {
  chesscom: ChesscomIcon,
  lichess: LichessIcon,
};

const platformLabels: Record<string, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
};

export default function LinkAccountScreen({ profile }: { profile: PlatformProfile }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const { linkAccount, setNeedsLinking } = useLinkedAccountsStore();
  const Icon = platformIcons[profile.platform];

  const handleLink = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const result = await linkAccount(user.id, profile);
    setLoading(false);
    if (!result.success) {
      setError(result.error === 'ALREADY_LINKED'
        ? 'This account is already linked to another user'
        : result.error || 'Failed to link');
    }
  };

  const ratings = Object.entries(profile.ratings).filter(([, v]) => v);

  return (
    <div className="link-screen">
      <div className="link-screen-header">
        <Icon size={24} />
        <h3>Link {platformLabels[profile.platform]} account</h3>
      </div>

      <div className="link-screen-card">
        {profile.avatarUrl && (
          <img className="link-screen-avatar" src={profile.avatarUrl} alt="" />
        )}
        <span className="link-screen-username">{profile.username}</span>
        {ratings.length > 0 && (
          <div className="link-screen-ratings">
            {ratings.map(([mode, rating]) => (
              <div key={mode} className="link-screen-rating">
                <span className="link-screen-rating-mode">{mode}</span>
                <span className="link-screen-rating-value">{rating}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="link-screen-error">{error}</p>}

      <button className="link-screen-btn" onClick={handleLink} disabled={loading}>
        {loading ? 'Linking...' : 'Link this account'}
      </button>

    </div>
  );
}
