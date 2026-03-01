import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  RefreshCw,
  Loader2,
  Link2,
  Unlink,
  Clock,
  Trash2,
  Ban,
  ShieldOff,
  Globe,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  canModifyRoles,
  canModifyPlans,
  planLabels,
  roleLabels,
  planColors,
  roleColors,
} from '@/lib/types'
import { formatDate, formatRelativeTime } from '@/lib/format'
import type { AdminUser, UserRole, UserPlan, LinkedAccountsData, UserIp } from './user-types'

interface UserEditDialogProps {
  editUser: AdminUser | null
  editPlan: UserPlan
  editRole: UserRole
  editExpiry: string
  saving: boolean
  userRole: UserRole
  linkedAccounts: LinkedAccountsData | null
  loadingAccounts: boolean
  unlinkingAccount: string | null
  unlinkingDiscord: boolean
  resyncingDiscord: boolean
  resyncResult: string | null
  removingCooldown: string | null
  onClose: () => void
  onSave: () => void
  onSetEditPlan: (plan: UserPlan) => void
  onSetEditRole: (role: UserRole) => void
  onSetEditExpiry: (expiry: string) => void
  onUnlinkAccount: (accountId: string) => void
  onUnlinkDiscord: (userId: string) => void
  onResyncDiscord: (userId: string) => void
  onRemoveCooldown: (accountId: string) => void
  onOpenDeleteDialog: (user: AdminUser) => void
  onOpenBanDialog: (user: AdminUser) => void
  onUnbanUser: (user: AdminUser) => void
}

export function UserEditDialog({
  editUser,
  editPlan,
  editRole,
  editExpiry,
  saving,
  userRole,
  linkedAccounts,
  loadingAccounts,
  unlinkingAccount,
  unlinkingDiscord,
  resyncingDiscord,
  resyncResult,
  removingCooldown,
  onClose,
  onSave,
  onSetEditPlan,
  onSetEditRole,
  onSetEditExpiry,
  onUnlinkAccount,
  onUnlinkDiscord,
  onResyncDiscord,
  onRemoveCooldown,
  onOpenDeleteDialog,
  onOpenBanDialog,
  onUnbanUser,
}: UserEditDialogProps) {
  const [showIps, setShowIps] = useState(false)

  return (
    <Dialog open={!!editUser} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit User</DialogTitle>
          <DialogDescription>{editUser?.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Role selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Role</label>
            {canModifyRoles(userRole) ? (
              <Select value={editRole} onValueChange={(v) => onSetEditRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="super_admin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center h-9">
                <Badge className={roleColors[editRole]}>{roleLabels[editRole]}</Badge>
                <span className="ml-2 text-xs text-muted-foreground">
                  (Only Super Admins can modify roles)
                </span>
              </div>
            )}
          </div>

          {/* Plan selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Plan</label>
            {canModifyPlans(userRole) ? (
              <Select value={editPlan} onValueChange={(v) => onSetEditPlan(v as UserPlan)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="freetrial">Free Trial</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="beta">Beta</SelectItem>
                  <SelectItem value="lifetime">Lifetime</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Badge className={planColors[editPlan]}>{planLabels[editPlan]}</Badge>
            )}
          </div>

          {/* Expiry date */}
          {(editPlan === 'freetrial' || editPlan === 'premium') && canModifyPlans(userRole) && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Plan Expiry</label>
              <Input
                type="date"
                value={editExpiry}
                onChange={(e) => onSetEditExpiry(e.target.value)}
              />
            </div>
          )}

          {/* Linked Accounts Section */}
          <div className="space-y-3 pt-4 border-t border-border/50">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <Link2 className="w-4 h-4" />
                Linked Accounts
              </label>
              {linkedAccounts && (
                <Badge variant="outline" className="text-xs">
                  {linkedAccounts.totalActive} active
                </Badge>
              )}
            </div>

            {loadingAccounts ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : linkedAccounts ? (
              <div className="space-y-3">
                {/* Active accounts */}
                {linkedAccounts.active.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Active</p>
                    {linkedAccounts.active.map((account) => (
                      <div key={account.id} className="space-y-1">
                        <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                          <div className="flex items-center gap-2">
                            <Link2 className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium">{account.platform_username}</span>
                            <Badge variant="outline" className="text-xs">
                              {account.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {account.rating_blitz && `${account.rating_blitz} blitz`}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onUnlinkAccount(account.id)}
                              disabled={unlinkingAccount === account.id}
                              className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            >
                              {unlinkingAccount === account.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Unlink className="w-3 h-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                        {account.ratings_updated_at && (
                          <p className="text-[10px] text-muted-foreground px-2">
                            Synced {formatRelativeTime(account.ratings_updated_at)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Unlinked accounts with cooldown */}
                {linkedAccounts.unlinked.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Unlinked (with cooldown)</p>
                    {linkedAccounts.unlinked.map((account) => (
                      <div
                        key={account.id}
                        className={`flex items-center justify-between p-2 rounded-lg ${
                          account.hasCooldown
                            ? 'bg-amber-500/10 border border-amber-500/20'
                            : 'bg-muted/30 border border-border/50'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Unlink className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">{account.platform_username}</span>
                          <Badge variant="outline" className="text-xs">
                            {account.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}
                          </Badge>
                          {account.hasCooldown && (
                            <span className="text-xs text-amber-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {account.hoursRemaining}h
                            </span>
                          )}
                        </div>
                        {account.hasCooldown && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onRemoveCooldown(account.id)}
                            disabled={removingCooldown === account.id}
                            className="h-7 px-2 text-xs text-amber-400 hover:text-amber-300"
                          >
                            {removingCooldown === account.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <>
                                <Trash2 className="w-3 h-3 mr-1" />
                                Remove cooldown
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Discord account */}
                {linkedAccounts.discord && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Discord</p>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
                        </svg>
                        <span className="text-sm font-medium">{linkedAccounts.discord.discord_username}</span>
                        <Badge variant="outline" className="text-xs">
                          {linkedAccounts.discord.discord_id}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editUser && onResyncDiscord(editUser.user_id)}
                          disabled={resyncingDiscord}
                          className="h-7 px-2 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                        >
                          {resyncingDiscord ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RefreshCw className="w-3 h-3" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editUser && onUnlinkDiscord(editUser.user_id)}
                          disabled={unlinkingDiscord}
                          className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          {unlinkingDiscord ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Unlink className="w-3 h-3" />
                          )}
                        </Button>
                      </div>
                    </div>
                    {resyncResult && (
                      <p className={`text-xs px-2 ${resyncResult.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
                        {resyncResult}
                      </p>
                    )}
                    {!resyncResult && linkedAccounts.discord.discord_roles_synced_at && (
                      <p className="text-[10px] text-muted-foreground px-2">
                        Roles synced {formatRelativeTime(linkedAccounts.discord.discord_roles_synced_at)}
                      </p>
                    )}
                  </div>
                )}

                {linkedAccounts.active.length === 0 && linkedAccounts.unlinked.length === 0 && !linkedAccounts.discord && (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    No linked accounts
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">
                Failed to load accounts
              </p>
            )}
          </div>
        </div>

        {/* IP Addresses Section */}
        {linkedAccounts && linkedAccounts.ips && linkedAccounts.ips.length > 0 && (
          <div className="space-y-2 pt-4 border-t border-border/50">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <Globe className="w-4 h-4" />
                IP Addresses
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowIps(!showIps)}
                className="h-7 px-2 text-xs gap-1"
              >
                {showIps ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showIps ? 'Hide' : 'Show'}
              </Button>
            </div>
            {showIps && (
              <div className="space-y-1.5">
                {linkedAccounts.ips.map((ip, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded-lg bg-muted/30 border border-border/30"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-foreground">{ip.ip_address}</code>
                      {ip.country && (
                        <span className="text-xs text-muted-foreground">
                          {ip.country_code && `${ip.country_code} `}{ip.country}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {formatRelativeTime(ip.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ban status indicator */}
        {editUser?.banned && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <div className="flex items-center gap-2 text-red-400 text-sm font-medium">
              <Ban className="w-4 h-4" />
              Banned
            </div>
            {editUser.ban_reason && (
              <p className="text-xs text-muted-foreground mt-1">{editUser.ban_reason}</p>
            )}
            {editUser.banned_by && editUser.banned_at && (
              <p className="text-xs text-muted-foreground mt-0.5">
                by {editUser.banned_by} on {formatDate(editUser.banned_at)}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 sm:mr-auto">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => editUser && onOpenDeleteDialog(editUser)}
              disabled={saving}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete
            </Button>
            {editUser?.banned ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => editUser && onUnbanUser(editUser)}
                disabled={saving}
                className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
              >
                <ShieldOff className="w-4 h-4 mr-1" />
                Unban
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => editUser && onOpenBanDialog(editUser)}
                disabled={saving}
                className="text-red-400 border-red-500/30 hover:bg-red-500/10"
              >
                <Ban className="w-4 h-4 mr-1" />
                Ban
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="gradient" onClick={onSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
