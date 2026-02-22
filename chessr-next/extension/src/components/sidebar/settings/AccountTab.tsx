import { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { CheckCircle, AlertCircle, Loader2, Crown, Clock, Sparkles, Lock } from 'lucide-react';
import type { Plan } from '../../ui/plan-badge';

function formatExpiryDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
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
  iconBg: string;
  showUpgrade?: boolean;
}

function getPlanInfo(plan: Plan, expiry: Date | null): PlanInfo {
  switch (plan) {
    case 'lifetime':
      return {
        title: 'Lifetime Access',
        description: 'You have permanent access.',
        icon: <Sparkles className="tw-w-5 tw-h-5 tw-text-yellow-500" />,
        iconBg: 'tw-bg-yellow-500/20',
      };
    case 'beta':
      return {
        title: 'Beta Tester',
        description: 'Thank you for being an early supporter! Enjoy lifetime access.',
        icon: <Crown className="tw-w-5 tw-h-5 tw-text-purple-500" />,
        iconBg: 'tw-bg-purple-500/20',
      };
    case 'premium':
      const premiumDays = expiry ? getDaysUntilExpiry(expiry) : 0;
      return {
        title: 'Premium',
        description: expiry
          ? `Your subscription renews on ${formatExpiryDate(expiry)}${premiumDays <= 7 ? ` (${premiumDays} days left)` : ''}`
          : 'Premium subscription active.',
        icon: <Crown className="tw-w-5 tw-h-5 tw-text-primary" />,
        iconBg: 'tw-bg-primary/20',
      };
    case 'freetrial':
      const trialDays = expiry ? getDaysUntilExpiry(expiry) : 0;
      return {
        title: 'Free Trial',
        description: expiry
          ? `${trialDays > 0 ? `${trialDays} days remaining` : 'Trial expired'} - Ends ${formatExpiryDate(expiry)}`
          : 'Trial period active.',
        icon: <Clock className="tw-w-5 tw-h-5 tw-text-orange-500" />,
        iconBg: 'tw-bg-orange-500/20',
        showUpgrade: true,
      };
    case 'free':
    default:
      return {
        title: 'Free Plan',
        description: 'Upgrade to unlock all features and boost your game.',
        icon: <Lock className="tw-w-5 tw-h-5 tw-text-muted-foreground" />,
        iconBg: 'tw-bg-muted',
        showUpgrade: true,
      };
  }
}

const UPGRADE_URL = 'https://discord.gg/72j4dUadTu';

export function AccountTab() {
  const { user, plan, planExpiry, changePassword, loading } = useAuthStore();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  const isEmailVerified = !!user?.email_confirmed_at;
  const signupDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const planInfo = getPlanInfo(plan, planExpiry);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }

    const result = await changePassword(oldPassword, newPassword);
    if (result.success) {
      setPasswordSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      setPasswordError(result.error || 'Failed to change password');
    }
  };

  return (
    <div className="tw-space-y-6">
      {/* Email Section */}
      <div className="tw-space-y-2">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Email</Label>
        <div className="tw-flex tw-items-center tw-gap-2">
          <span className="tw-text-sm tw-text-foreground">{user?.email}</span>
          {isEmailVerified ? (
            <span className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-success">
              <CheckCircle className="tw-w-3 tw-h-3" />
              Verified
            </span>
          ) : (
            <span className="tw-flex tw-items-center tw-gap-1 tw-text-xs tw-text-warning">
              <AlertCircle className="tw-w-3 tw-h-3" />
              Not verified
            </span>
          )}
        </div>
      </div>

      {/* Signup Date */}
      {signupDate && (
        <div className="tw-space-y-2">
          <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Member since</Label>
          <p className="tw-text-sm tw-text-foreground">{signupDate}</p>
        </div>
      )}

      {/* Change Password Section */}
      <div className="tw-space-y-3 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Change Password</Label>
        <form onSubmit={handleChangePassword} className="tw-space-y-3">
          <div className="tw-space-y-1">
            <Label htmlFor="old-password" className="tw-text-xs">Current Password</Label>
            <Input
              id="old-password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Enter current password"
              className="tw-h-8 tw-text-sm"
            />
          </div>
          <div className="tw-space-y-1">
            <Label htmlFor="new-password" className="tw-text-xs">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              className="tw-h-8 tw-text-sm"
            />
          </div>
          <div className="tw-space-y-1">
            <Label htmlFor="confirm-password" className="tw-text-xs">Confirm New Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="tw-h-8 tw-text-sm"
            />
          </div>
          {passwordError && (
            <p className="tw-text-xs tw-text-destructive">{passwordError}</p>
          )}
          {passwordSuccess && (
            <p className="tw-text-xs tw-text-success">Password changed successfully!</p>
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
                Changing...
              </>
            ) : (
              'Change Password'
            )}
          </Button>
        </form>
      </div>

      {/* Billing Section */}
      <div className="tw-space-y-3 tw-pt-4 tw-border-t tw-border-border">
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Subscription</Label>
        <div className="tw-flex tw-items-center tw-gap-3 tw-p-3 tw-rounded-lg tw-bg-muted">
          <div className={`tw-flex tw-items-center tw-justify-center tw-w-10 tw-h-10 tw-rounded-full ${planInfo.iconBg}`}>
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
          <Button
            variant="outline"
            size="sm"
            className="tw-w-full"
            onClick={() => window.open(UPGRADE_URL, '_blank')}
          >
            <Sparkles className="tw-w-3 tw-h-3 tw-mr-1" />
            Upgrade Now
          </Button>
        )}
      </div>
    </div>
  );
}
