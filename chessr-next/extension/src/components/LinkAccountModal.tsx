/**
 * LinkAccountModal - Modal to link Chess.com or Lichess account
 * Styled to match AuthForm
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, AlertCircle, Loader2, User } from 'lucide-react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { useLinkedAccountsStore, usePendingProfile, useLinkError, useIsLinkingLoading } from '../stores/linkedAccountsStore';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { webSocketManager } from '../lib/webSocket';

interface RatingBadgeProps {
  label: string;
  rating?: number;
}

function RatingBadge({ label, rating }: RatingBadgeProps) {
  if (!rating) return null;

  return (
    <div className="tw-flex tw-flex-col tw-items-center tw-px-4 tw-py-2 tw-bg-muted/50 tw-rounded-lg">
      <span className="tw-text-xs tw-text-muted-foreground">{label}</span>
      <span className="tw-text-base tw-font-semibold">{rating}</span>
    </div>
  );
}

interface ErrorDisplayProps {
  error: {
    message: string;
    code: string;
  };
}

function ErrorDisplay({ error }: ErrorDisplayProps) {
  const { t } = useTranslation(['banners', 'common']);

  const title =
    error.code === 'ALREADY_LINKED' ? t('banners:accountAlreadyLinked') : t('common:error');

  return (
    <div className="tw-bg-destructive/10 tw-border tw-border-destructive/30 tw-text-destructive tw-text-xs tw-rounded-lg tw-p-3">
      <div className="tw-flex tw-items-start tw-gap-2">
        <AlertCircle className="tw-w-4 tw-h-4 tw-flex-shrink-0 tw-mt-0.5" />
        <div>
          <div className="tw-font-semibold tw-mb-0.5">{title}</div>
          <div className="tw-opacity-80">{error.message}</div>
        </div>
      </div>
    </div>
  );
}

export function LinkAccountModal() {
  const pendingProfile = usePendingProfile();
  const linkError = useLinkError();
  const isLoading = useIsLinkingLoading();
  const { setLoading, setLinkError } = useLinkedAccountsStore();
  const { signOut } = useAuthStore();
  const anonNames = useSettingsStore((s) => s.anonNames);
  const { t } = useTranslation(['banners', 'common']);
  const [isLinking, setIsLinking] = useState(false);

  if (!pendingProfile) {
    return null;
  }

  const handleLink = async () => {
    if (isLinking || isLoading) return;

    setIsLinking(true);
    setLinkError(null);
    setLoading(true);

    webSocketManager.send({
      type: 'link_account',
      platform: pendingProfile.platform,
      username: pendingProfile.username,
      avatarUrl: pendingProfile.avatarUrl,
      ratingBullet: pendingProfile.ratings.bullet,
      ratingBlitz: pendingProfile.ratings.blitz,
      ratingRapid: pendingProfile.ratings.rapid,
    });

    setIsLinking(false);
  };

  const platformName = pendingProfile.platform === 'chesscom' ? 'Chess.com' : 'Lichess';

  return (
    <div className="tw-h-full">
      <Card className="tw-h-full tw-flex tw-flex-col tw-overflow-hidden">
        {/* Header with gradient background - matches AuthForm */}
        <div className="tw-bg-gradient-to-b tw-from-blue-500/20 tw-to-transparent tw-p-6 tw-text-center">
          {/* Chessr Logo */}
          <img
            src={chrome.runtime.getURL('icons/chessr-logo.png')}
            alt="Chessr"
            className="tw-w-12 tw-h-12 tw-mx-auto tw-mb-2"
          />
          <h1 className="tw-text-xl tw-font-bold tw-tracking-tight tw-mb-4">
            <span className="tw-text-foreground">chessr</span>
            <span className="tw-text-secondary">.io</span>
          </h1>

          {/* Platform Avatar */}
          {pendingProfile.avatarUrl ? (
            <img
              src={pendingProfile.avatarUrl}
              alt={pendingProfile.username}
              className={`tw-w-16 tw-h-16 tw-mx-auto tw-mb-2 tw-rounded-full tw-border-2 tw-border-primary tw-shadow-lg ${anonNames ? 'tw-blur-sm' : ''}`}
            />
          ) : (
            <div className="tw-w-16 tw-h-16 tw-mx-auto tw-mb-2 tw-rounded-full tw-bg-muted tw-flex tw-items-center tw-justify-center tw-border-2 tw-border-primary">
              <User className="tw-w-8 tw-h-8 tw-text-muted-foreground" />
            </div>
          )}

          {/* Username */}
          <p className={`tw-text-base tw-font-semibold tw-mb-0.5 ${anonNames ? 'tw-blur-sm' : ''}`}>
            {pendingProfile.username}
          </p>
          <p className="tw-text-xs tw-text-muted-foreground">
            {t('banners:platformAccount', { platform: platformName })}
          </p>
        </div>

        {/* Content */}
        <div className="tw-p-4 tw-flex-1 tw-flex tw-flex-col">
          {/* Ratings */}
          <div className="tw-flex tw-justify-center tw-gap-3 tw-mb-4">
            <RatingBadge label={t('banners:bullet')} rating={pendingProfile.ratings.bullet} />
            <RatingBadge label={t('banners:blitz')} rating={pendingProfile.ratings.blitz} />
            <RatingBadge label={t('banners:rapid')} rating={pendingProfile.ratings.rapid} />
          </div>

          <div className="tw-bg-muted/30 tw-border tw-border-border/50 tw-rounded-lg tw-p-3 tw-mb-4">
            <div className="tw-flex tw-items-start tw-gap-2">
              <Link2 className="tw-w-4 tw-h-4 tw-text-primary tw-flex-shrink-0 tw-mt-0.5" />
              <div className="tw-text-xs tw-text-muted-foreground">
                <span className="tw-font-medium tw-text-foreground">{t('banners:linkAccount')}</span> {t('banners:linkAccountDesc')}
              </div>
            </div>
          </div>

          {/* Error display */}
          {linkError && <ErrorDisplay error={linkError} />}

          {/* Spacer */}
          <div className="tw-flex-1" />

          {/* Actions */}
          <div className="tw-space-y-2 tw-mt-4">
            <Button
              className="tw-w-full tw-bg-gradient-to-r tw-from-primary tw-to-secondary hover:tw-opacity-90 tw-transition-opacity"
              onClick={handleLink}
              disabled={isLoading || isLinking}
            >
              {isLoading ? (
                <>
                  <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin tw-mr-2" />
                  {t('banners:linking')}
                </>
              ) : (
                <>
                  <Link2 className="tw-w-4 tw-h-4 tw-mr-2" />
                  {t('banners:linkThisAccount')}
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              className="tw-w-full tw-text-muted-foreground hover:tw-text-foreground"
              onClick={() => signOut()}
              disabled={isLoading}
            >
              {t('common:signOut')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
