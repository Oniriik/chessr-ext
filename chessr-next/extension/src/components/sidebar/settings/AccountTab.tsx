import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import i18n from '../../../i18n/i18n';
import { useAuthStore } from '../../../stores/authStore';
import { useLinkedAccountsStore, useLinkedAccounts, useIsLinkingLoading } from '../../../stores/linkedAccountsStore';
import { useExplanationStore, useExplanationDailyUsage, useExplanationDailyLimit } from '../../../stores/explanationStore';
import { webSocketManager } from '../../../lib/webSocket';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { CheckCircle, AlertCircle, Loader2, Crown, Clock, Sparkles, Lock, Link2, Unlink, User, MessageCircle } from 'lucide-react';
import { useDiscordStore } from '../../../stores/discordStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { getRealHref } from '../../../content/anonymousBlur';
import { useIsPremium } from '../../../lib/planUtils';
import { openCheckout, type CheckoutPlan } from '../../../lib/checkoutClient';
import type { Plan } from '../../ui/plan-badge';

function formatExpiryDate(date: Date): string {
  return date.toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getDaysUntilExpiry(date: Date): number {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

interface PlanInfo {
  title: string;
  description: string;
  icon: React.ReactNode;
  bgColor: string;
  showUpgrade?: boolean;
}

// Colors synced with plan-badge.tsx
const planColors: Record<Plan, { bg: string; text: string }> = {
  lifetime: { bg: '#8263F1', text: '#3F2F7A' },
  beta: { bg: '#6366f1', text: '#252972' },
  premium: { bg: '#60a5fa', text: '#264A70' },
  freetrial: { bg: '#9c4040', text: '#481A1A' },
  free: { bg: '#EAB308', text: '#574407' },
};

function getPlanInfo(plan: Plan, expiry: Date | null, t: TFunction): PlanInfo {
  const colors = planColors[plan];

  switch (plan) {
    case 'lifetime':
      return {
        title: t('lifetimeAccess'),
        description: t('lifetimeDesc'),
        icon: <Sparkles className="tw-w-5 tw-h-5" style={{ color: colors.bg }} />,
        bgColor: `${colors.bg}20`,
      };
    case 'beta':
      return {
        title: t('betaTester'),
        description: t('betaDesc'),
        icon: <Crown className="tw-w-5 tw-h-5" style={{ color: colors.bg }} />,
        bgColor: `${colors.bg}20`,
      };
    case 'premium':
      const premiumDays = expiry ? getDaysUntilExpiry(expiry) : 0;
      return {
        title: t('premium'),
        description: expiry
          ? premiumDays <= 7
            ? t('premiumDaysLeft', { date: formatExpiryDate(expiry), days: premiumDays })
            : t('premiumRenews', { date: formatExpiryDate(expiry) })
          : t('premiumActive'),
        icon: <Crown className="tw-w-5 tw-h-5" style={{ color: colors.bg }} />,
        bgColor: `${colors.bg}20`,
      };
    case 'freetrial':
      const trialDays = expiry ? getDaysUntilExpiry(expiry) : 0;
      const remaining = trialDays > 0
        ? t('freeTrialRemaining', { days: trialDays })
        : t('trialExpired');
      return {
        title: t('freeTrial'),
        description: expiry
          ? t('freeTrialEnds', { remaining, date: formatExpiryDate(expiry) })
          : t('trialActive'),
        icon: <Clock className="tw-w-5 tw-h-5" style={{ color: colors.bg }} />,
        bgColor: `${colors.bg}20`,
        showUpgrade: true,
      };
    case 'free':
    default:
      return {
        title: t('freePlan'),
        description: t('freePlanDesc'),
        icon: <Lock className="tw-w-5 tw-h-5" style={{ color: colors.bg }} />,
        bgColor: `${colors.bg}20`,
        showUpgrade: true,
      };
  }
}

// Plan selection for checkout
const CHECKOUT_PLANS: { key: CheckoutPlan; label: string; price: string }[] = [
  { key: 'monthly', label: 'Monthly', price: '€2.99/mo' },
  { key: 'yearly', label: 'Yearly', price: '€24.99/yr' },
  { key: 'lifetime', label: 'Lifetime', price: '€49.99' },
];

function LinkedAccountsSection() {
  const { t } = useTranslation('settings');
  const linkedAccounts = useLinkedAccounts();
  const isLoading = useIsLinkingLoading();
  const { setLoading } = useLinkedAccountsStore();
  const anonNames = useSettingsStore((s) => s.anonNames);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  const handleUnlink = (accountId: string) => {
    if (unlinkingId) return;

    setUnlinkingId(accountId);
    setLoading(true);
    webSocketManager.send({ type: 'unlink_account', accountId });

    // Reset after timeout (in case of no response)
    setTimeout(() => {
      setUnlinkingId(null);
      setLoading(false);
    }, 10000);
  };

  if (linkedAccounts.length === 0) {
    return (
      <div className="tw-space-y-2 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('linkedAccounts')}</Label>
        <div className="tw-flex tw-items-center tw-gap-2 tw-p-3 tw-rounded-lg tw-bg-muted/50 tw-border tw-border-dashed tw-border-border">
          <Link2 className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
          <p className="tw-text-sm tw-text-muted-foreground">{t('noAccountsLinked')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-space-y-2 tw-pt-4 tw-border-t tw-border-border">
      <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('linkedAccounts')}</Label>
      <div className="tw-space-y-2">
        {linkedAccounts.map((account) => {
          const platformName = account.platform === 'chesscom' ? 'Chess.com' : 'Lichess';
          const isUnlinking = unlinkingId === account.id;

          return (
            <div
              key={account.id}
              className="tw-flex tw-items-center tw-gap-3 tw-p-3 tw-rounded-lg tw-bg-muted/50"
            >
              {/* Avatar or icon */}
              <div className="tw-flex-shrink-0">
                {account.avatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt={account.platformUsername}
                    className={`tw-w-10 tw-h-10 tw-rounded-full tw-border tw-border-border ${anonNames ? 'tw-blur-sm' : ''}`}
                  />
                ) : (
                  <div className="tw-w-10 tw-h-10 tw-rounded-full tw-bg-muted tw-flex tw-items-center tw-justify-center tw-border tw-border-border">
                    <User className="tw-w-5 tw-h-5 tw-text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="tw-flex-1 tw-min-w-0">
                <p className={`tw-text-sm tw-font-medium tw-truncate ${anonNames ? 'tw-blur-sm' : ''}`}>{account.platformUsername}</p>
                <p className="tw-text-xs tw-text-muted-foreground">{platformName}</p>
              </div>

              {/* Unlink button */}
              <Button
                variant="ghost"
                size="icon"
                className="tw-h-8 tw-w-8 tw-flex-shrink-0"
                onClick={() => handleUnlink(account.id)}
                disabled={isLoading || isUnlinking}
                title={t('unlinkAccount')}
              >
                {isUnlinking ? (
                  <Loader2 className="tw-w-4 tw-h-4 tw-animate-spin" />
                ) : (
                  <Unlink className="tw-w-4 tw-h-4" />
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiscordSection() {
  const { t } = useTranslation('settings');
  const { isLinked, discordUsername, discordAvatar, isLinking, setLinking } = useDiscordStore();
  const anonNames = useSettingsStore((s) => s.anonNames);

  const handleLink = () => {
    if (isLinking) return;
    setLinking(true);
    webSocketManager.send({
      type: 'init_discord_link',
      returnUrl: getRealHref(),
    });
  };

  const handleUnlink = () => {
    webSocketManager.send({ type: 'unlink_discord' });
    // State will be updated by discord_unlink_success WebSocket handler
  };

  return (
    <div className="tw-space-y-2 tw-pt-4 tw-border-t tw-border-border">
      <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Discord</Label>
      {isLinked ? (
        <div className="tw-flex tw-items-center tw-gap-3 tw-p-3 tw-rounded-lg tw-bg-muted/50">
          <div className="tw-flex-shrink-0">
            {discordAvatar ? (
              <img
                src={discordAvatar}
                alt={discordUsername || 'Discord'}
                crossOrigin="anonymous"
                className={`tw-w-10 tw-h-10 tw-rounded-full tw-border tw-border-border ${anonNames ? 'tw-blur-sm' : ''}`}
              />
            ) : (
              <div className="tw-w-10 tw-h-10 tw-rounded-full tw-bg-indigo-500/20 tw-flex tw-items-center tw-justify-center tw-border tw-border-indigo-500/30">
                <MessageCircle className="tw-w-5 tw-h-5 tw-text-indigo-400" />
              </div>
            )}
          </div>
          <div className="tw-flex-1 tw-min-w-0">
            <p className={`tw-text-sm tw-font-medium tw-truncate ${anonNames ? 'tw-blur-sm' : ''}`}>{discordUsername}</p>
            <p className="tw-text-xs tw-text-muted-foreground">Discord</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="tw-h-8 tw-w-8 tw-flex-shrink-0"
            onClick={handleUnlink}
            title={t('unlinkDiscord')}
          >
            <Unlink className="tw-w-4 tw-h-4" />
          </Button>
        </div>
      ) : (
        <button
          onClick={handleLink}
          disabled={isLinking}
          className="tw-flex tw-items-center tw-gap-2 tw-p-3 tw-rounded-lg tw-bg-muted/50 tw-border tw-border-dashed tw-border-border tw-w-full tw-text-left tw-cursor-pointer hover:tw-bg-muted/80 tw-transition-colors disabled:tw-opacity-50"
        >
          <MessageCircle className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
          <p className="tw-text-sm tw-text-muted-foreground">
            {isLinking ? t('redirectingToDiscord') : t('linkDiscordAccount')}
          </p>
        </button>
      )}
    </div>
  );
}

export function AccountTab() {
  const { t } = useTranslation(['settings', 'common']);
  const { user, plan, planExpiry, changePassword, loading } = useAuthStore();
  const anonNames = useSettingsStore((s) => s.anonNames);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const isEmailVerified = !!user?.email_confirmed_at;
  const signupDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(i18n.language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const planInfo = getPlanInfo(plan, planExpiry, t);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError(t('settings:passwordsDoNotMatch'));
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError(t('settings:passwordMinLength'));
      return;
    }

    const result = await changePassword(oldPassword, newPassword);
    if (result.success) {
      setPasswordSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setPasswordError(result.error || t('settings:failedToChangePassword'));
    }
  };

  return (
    <div className="tw-space-y-6">
      {/* Email Section */}
      <div className="tw-space-y-2">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('settings:emailSection')}</Label>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className={`tw-text-sm tw-text-foreground ${anonNames ? 'tw-blur-sm' : ''}`}>{user?.email}</span>
          {isEmailVerified ? (
            <span className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-success">
              <CheckCircle className="tw-w-3 tw-h-3" />
              {t('settings:verified')}
            </span>
          ) : (
            <span className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-warning">
              <AlertCircle className="tw-w-3 tw-h-3" />
              {t('settings:notVerified')}
            </span>
          )}
        </div>
      </div>

      {/* Signup Date */}
      {signupDate && (
        <div className="tw-space-y-2">
          <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('settings:memberSince')}</Label>
          <p className="tw-text-sm tw-text-foreground">{signupDate}</p>
        </div>
      )}

      {/* Linked Accounts Section */}
      <LinkedAccountsSection />

      {/* Discord Section */}
      <DiscordSection />

      {/* Change Password Section */}
      <div className="tw-space-y-3 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('settings:changePassword')}</Label>
        <form onSubmit={handleChangePassword} className="tw-space-y-3">
          <div className="tw-space-y-1">
            <Label htmlFor="old-password" className="tw-text-xs">{t('settings:currentPassword')}</Label>
            <Input
              id="old-password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder={t('settings:enterCurrentPassword')}
              className="tw-h-8 tw-text-sm"
            />
          </div>
          <div className="tw-space-y-1">
            <Label htmlFor="new-password" className="tw-text-xs">{t('settings:newPassword')}</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('settings:enterNewPassword')}
              className="tw-h-8 tw-text-sm"
            />
          </div>
          <div className="tw-space-y-1">
            <Label htmlFor="confirm-password" className="tw-text-xs">{t('settings:confirmNewPassword')}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('settings:confirmNewPasswordPlaceholder')}
              className="tw-h-8 tw-text-sm"
            />
          </div>
          {passwordError && (
            <p className="tw-text-xs tw-text-destructive">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="tw-text-xs tw-text-success">{t('settings:passwordChanged')}</p>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={loading || !oldPassword || !newPassword || !confirmPassword}
            className="tw-w-full"
          >
            {loading ? (
              <>
                <Loader2 className="tw-w-3 tw-h-3 tw-animate-spin tw-mr-1" />
                {t('settings:changing')}
              </>
            ) : (
              t('settings:changePassword')
            )}
          </Button>
        </form>
      </div>

      {/* Billing Section */}
      <div className="tw-space-y-3 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('settings:subscription')}</Label>
        <div className="tw-flex tw-items-center tw-gap-3 tw-p-3 tw-rounded-lg tw-bg-muted">
          <div className="tw-flex tw-items-center tw-justify-center tw-w-10 tw-h-10 tw-rounded-full" style={{ backgroundColor: planInfo.bgColor }}>
            {planInfo.icon}
          </div>
          <div className="tw-flex-1">
            <p className="tw-text-sm tw-font-medium tw-text-foreground">{planInfo.title}</p>
            <p className="tw-text-xs tw-text-muted-foreground">
              {planInfo.description}
            </p>
          </div>
        </div>
        {planInfo.showUpgrade && (
          <div className="tw-space-y-2">
            {CHECKOUT_PLANS.map((cp) => (
              <Button
                key={cp.key}
                variant="outline"
                size="sm"
                className="tw-w-full tw-justify-between"
                onClick={() => {
                  const token = useAuthStore.getState().session?.access_token;
                  if (token) openCheckout(cp.key, token);
                }}
              >
                <span className="tw-flex tw-items-center tw-gap-1">
                  <Sparkles className="tw-w-3 tw-h-3" />
                  {cp.label}
                </span>
                <span className="tw-text-xs tw-text-muted-foreground">{cp.price}</span>
              </Button>
            ))}
          </div>
        )}
      </div>

      {/* Move Explanations Quota */}
      <ExplanationQuotaSection />
    </div>
  );
}

function ExplanationQuotaSection() {
  const { t } = useTranslation('settings');
  const isPremium = useIsPremium();
  const dailyUsage = useExplanationDailyUsage();
  const dailyLimit = useExplanationDailyLimit();
  const fetchUsage = useExplanationStore((s) => s.fetchUsage);

  useEffect(() => {
    if (isPremium) {
      fetchUsage();
    }
  }, [isPremium, fetchUsage]);

  const percentage = dailyLimit > 0 ? Math.min((dailyUsage / dailyLimit) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div className="tw-space-y-3 tw-pt-4 tw-border-t tw-border-border">
      <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">{t('moveExplanations')}</Label>
      {isPremium ? (
        <div className="tw-p-3 tw-rounded-lg tw-bg-muted/50">
          <div className="tw-flex tw-items-center tw-justify-between tw-mb-2">
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <Sparkles className="tw-w-3.5 tw-h-3.5 tw-text-violet-400" />
              <span className="tw-text-sm tw-font-medium">{t('dailyUsage')}</span>
            </div>
            <span className={`tw-text-sm tw-font-mono tw-font-bold ${
              isAtLimit ? 'tw-text-rose-400' : isNearLimit ? 'tw-text-amber-400' : 'tw-text-violet-400'
            }`}>
              {dailyUsage}/{dailyLimit}
            </span>
          </div>
          {/* Progress bar */}
          <div className="tw-h-1.5 tw-rounded-full tw-bg-muted tw-overflow-hidden">
            <div
              className={`tw-h-full tw-rounded-full tw-transition-all tw-duration-300 ${
                isAtLimit ? 'tw-bg-rose-500' : isNearLimit ? 'tw-bg-amber-500' : 'tw-bg-violet-500'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <p className="tw-text-[10px] tw-text-muted-foreground tw-mt-1.5">
            {isAtLimit ? t('limitReachedResets') : t('resetsAtMidnight')}
          </p>
        </div>
      ) : (
        <div className="tw-flex tw-items-center tw-gap-2 tw-p-3 tw-rounded-lg tw-bg-muted/50 tw-border tw-border-dashed tw-border-border">
          <Lock className="tw-w-4 tw-h-4 tw-text-muted-foreground" />
          <p className="tw-text-sm tw-text-muted-foreground">{t('upgradeToUnlockExplanations')}</p>
        </div>
      )}
    </div>
  );
}
