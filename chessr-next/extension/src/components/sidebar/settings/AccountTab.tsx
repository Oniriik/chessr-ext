import { useState } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { CheckCircle, AlertCircle, Loader2, Crown } from 'lucide-react';

export function AccountTab() {
  const { user, changePassword, loading } = useAuthStore();
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
        <Label className="tw-text-xs tw-text-muted-foreground tw-uppercase">Billing</Label>
        <div className="tw-flex tw-items-center tw-gap-3 tw-p-3 tw-rounded-lg tw-bg-muted">
          <div className="tw-flex tw-items-center tw-justify-center tw-w-10 tw-h-10 tw-rounded-full tw-bg-primary/20">
            <Crown className="tw-w-5 tw-h-5 tw-text-primary" />
          </div>
          <div>
            <p className="tw-text-sm tw-font-medium tw-text-foreground">Beta Tester</p>
            <p className="tw-text-xs tw-text-muted-foreground">
              Enjoy full access during the beta period
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
