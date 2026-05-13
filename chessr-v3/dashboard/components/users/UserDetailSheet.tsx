'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle, Ban, CalendarIcon, Check, ChevronDown, Copy, Crown,
  Fingerprint, Globe, Link2, Loader2, Mail, MessageSquare, MoreVertical,
  Plus, RefreshCw, Shield, ShieldCheck, Trash2, Unlink, User as UserIcon, X,
} from 'lucide-react';
import { format } from 'date-fns';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { planBadgeStyle } from '@/lib/plan-colors';
import { BoostInventory } from './BoostInventory';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Calendar } from '@/components/ui/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getSupabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/roles';
import { useResolvedDiscordUsers } from '@/components/discord/useResolvedDiscordUsers';

// ─── Types ─────────────────────────────────────────────────────────────
type LinkedAccount = {
  platform: string;
  platform_username: string;
  platform_user_id: string | null;
  avatar_url: string | null;
  rating_bullet: number | null;
  rating_blitz: number | null;
  rating_rapid: number | null;
  linked_at: string;
};
type Fingerprint = { fingerprint: string; created_at: string };
type Ip = { ip_address: string; country: string | null; country_code: string | null; created_at: string };
type Note = {
  id: string;
  note: string;
  created_at: string;
  author_id: string | null;
  author_email: string | null;
  author_discord: string | null;
};

type Subscription = {
  paddle_subscription_id: string | null;
  status: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  interval: string | null;
};

type UserDetail = {
  user: {
    user_id: string;
    email: string;
    joined_at: string;
    last_sign_in_at: string | null;
    email_verified: boolean;
    plan: 'free' | 'freetrial' | 'premium' | 'beta' | 'lifetime' | 'unlocker';
    plan_expiry: string | null;
    freetrial_used: boolean;
    role: UserRole;
    banned: boolean;
    ban_reason: string | null;
    discord_id: string | null;
    discord_username: string | null;
  };
  linked_accounts: LinkedAccount[];
  fingerprints: Fingerprint[];
  ips: Ip[];
  notes: Note[];
  subscription: Subscription | null;
};

const PLANS = ['free', 'freetrial', 'premium', 'beta', 'lifetime', 'unlocker'] as const;
const ROLES: UserRole[] = ['user', 'admin', 'super_admin'];
// Plans where an expiry makes no sense: free has no entitlements to expire,
// lifetime is forever by definition.
const PLANS_WITHOUT_EXPIRY: ReadonlySet<string> = new Set(['free', 'lifetime']);

// ─── Helpers ───────────────────────────────────────────────────────────
// Plan colors are centralised in lib/plan-colors — see planBadgeStyle.

function roleVariant(role: UserRole): 'destructive' | 'default' | 'muted' {
  if (role === 'super_admin') return 'destructive';
  if (role === 'admin') return 'default';
  return 'muted';
}

async function getToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

// ─── Collapsible row with count badge in header ─────────────────────────
function Section({
  icon: Icon, label, count, children,
}: {
  icon: typeof Mail;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-[12px] font-medium hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <Icon size={13} strokeWidth={2.2} className="text-muted-foreground" />
          {label}
          <Badge variant="muted" className="px-1.5 py-0.5 text-[10px]">{count}</Badge>
        </span>
        <ChevronDown
          size={14}
          className={cn('text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 p-3">
          {count === 0 ? (
            <p className="text-[11px] text-muted-foreground">No data.</p>
          ) : children}
        </div>
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
      title={`Copy ${label ?? 'value'}`}
    >
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  );
}

function fmt(ts: string | null): string {
  if (!ts) return '—';
  try { return format(new Date(ts), 'MMM d, yyyy'); }
  catch { return ts; }
}
function fmtDateTime(ts: string | null): string {
  if (!ts) return '—';
  try { return format(new Date(ts), 'MMM d, yyyy · HH:mm'); }
  catch { return ts; }
}

// ─── Main sheet ────────────────────────────────────────────────────────
export function UserDetailSheet({
  userId,
  open,
  onClose,
  callerRole,
  onUpdated,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  callerRole: UserRole;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editingPlan, setEditingPlan] = useState<typeof PLANS[number] | null>(null);
  const [editingExpiry, setEditingExpiry] = useState<Date | undefined>(undefined);
  const [editingRole, setEditingRole] = useState<UserRole | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  // Email change
  const [emailEdit, setEmailEdit] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  // Action statuses
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);

  // Discord role re-sync (manual override when the bot drifted out of
  // sync — e.g. it was down at the time of the plan change). Status
  // string instead of bool so the button can briefly flash "synced".
  const [syncingRoles, setSyncingRoles] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);

  // Paddle extend (separate from manual plan_expiry edit — for users with
  // an active Paddle subscription where the date is the source of truth).
  // Two-step flow: input → "Add" reveals confirm/cancel buttons → confirm
  // actually fires the request. Avoids accidental clicks pushing renewal
  // dates we can't easily roll back.
  const [extendDays, setExtendDays] = useState<number | ''>(7);
  const [extendingPaddle, setExtendingPaddle] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [extendConfirming, setExtendConfirming] = useState(false);

  // Track per-account unlink state. Keyed by `${platform}:${username}`.
  const [unlinkingKey, setUnlinkingKey] = useState<string | null>(null);

  // Notes
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Destructive header actions (ban / delete). One panel at a time, gated
  // by a password re-entry — guards against drive-by clicks on a logged-in
  // dashboard left unattended.
  const [destructive, setDestructive] = useState<'ban' | 'delete' | null>(null);
  const [destructivePassword, setDestructivePassword] = useState('');
  const [destructiveReason, setDestructiveReason] = useState('');
  const [destructiveBusy, setDestructiveBusy] = useState(false);

  // ─── Fetch on open ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setDetail(null);
      setEditingPlan(null);
      setEditingExpiry(undefined);
      setEditingRole(null);
      setShowCalendar(false);
      setEmailEdit(false);
      setResetLink(null);
      setNewNote('');
      setDestructive(null);
      setDestructivePassword('');
      setDestructiveReason('');
      setExtendDays(7);
      setExtendError(null);
      setExtendConfirming(false);
      try {
        const token = await getToken();
        if (!token) throw new Error('No session');
        const res = await fetch(`/api/admin/users/${userId}?token=${encodeURIComponent(token)}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setDetail(json);
        setEditingPlan(json.user.plan);
        setEditingExpiry(json.user.plan_expiry ? new Date(json.user.plan_expiry) : undefined);
        setEditingRole(json.user.role);
        setNewEmail(json.user.email);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, open]);

  // ─── Mutations ──────────────────────────────────────────────────────
  async function patch(body: Record<string, unknown>) {
    const token = await getToken();
    const res = await fetch(`/api/admin/users/${userId}?token=${encodeURIComponent(token ?? '')}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  async function syncDiscordRoles() {
    if (!detail?.user.discord_id) return;
    setSyncingRoles(true);
    setSyncStatus('idle');
    setSyncError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/admin/users/${userId}/sync-discord-roles?token=${encodeURIComponent(token ?? '')}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSyncStatus('ok');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncingRoles(false);
    }
  }

  async function extendPaddle() {
    if (!detail || typeof extendDays !== 'number' || extendDays <= 0) return;
    setExtendingPaddle(true);
    setExtendError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/admin/users/${userId}/extend-paddle?token=${encodeURIComponent(token ?? '')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ days: extendDays }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // The webhook propagates Paddle's new nextBilledAt to user_settings,
      // but it can take a couple of seconds. Optimistically reflect the
      // returned date so the admin sees immediate feedback.
      if (json.nextBilledAt) {
        setDetail({
          ...detail,
          user: { ...detail.user, plan_expiry: json.nextBilledAt },
          subscription: detail.subscription
            ? { ...detail.subscription, current_period_end: json.nextBilledAt }
            : null,
        });
        setEditingExpiry(new Date(json.nextBilledAt));
      }
      setExtendConfirming(false);
      onUpdated();
    } catch (err) {
      setExtendError(err instanceof Error ? err.message : 'Extend failed');
    } finally {
      setExtendingPaddle(false);
    }
  }

  async function savePlan() {
    if (!detail || !editingPlan) return;
    // free / lifetime can't have an expiry — coerce to null so the row stays
    // clean even if the admin toggled plans around in this session.
    const expiryToSave = PLANS_WITHOUT_EXPIRY.has(editingPlan)
      ? null
      : (editingExpiry ? editingExpiry.toISOString() : null);
    setSavingPlan(true);
    setError(null);
    try {
      await patch({ plan: editingPlan, plan_expiry: expiryToSave });
      setDetail({
        ...detail,
        user: { ...detail.user, plan: editingPlan, plan_expiry: expiryToSave },
      });
      setShowCalendar(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPlan(false);
    }
  }

  async function saveRole() {
    if (!detail || !editingRole) return;
    setSavingRole(true);
    setError(null);
    try {
      await patch({ role: editingRole });
      setDetail({ ...detail, user: { ...detail.user, role: editingRole } });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingRole(false);
    }
  }

  async function saveEmail() {
    if (!detail || !newEmail || newEmail === detail.user.email) {
      setEmailEdit(false);
      return;
    }
    setSavingEmail(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/users/${userId}/email?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail({ ...detail, user: { ...detail.user, email: json.email, email_verified: true } });
      setEmailEdit(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email update failed');
    } finally {
      setSavingEmail(false);
    }
  }

  async function addNote() {
    if (!detail || !userId) return;
    const body = newNote.trim();
    if (!body) return;
    setAddingNote(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/users/${userId}/notes?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Refetch the whole detail rather than building author display info
      // client-side — RPC already resolves email/discord_username for us.
      const refresh = await fetch(`/api/admin/users/${userId}?token=${encodeURIComponent(token ?? '')}`);
      const next = await refresh.json();
      if (refresh.ok) setDetail(next);
      setNewNote('');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add note failed');
    } finally {
      setAddingNote(false);
    }
  }

  async function deleteNote(noteId: string) {
    if (!detail || !userId) return;
    setDeletingNoteId(noteId);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `/api/admin/users/${userId}/notes/${noteId}?token=${encodeURIComponent(token ?? '')}`,
        { method: 'DELETE' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDetail({ ...detail, notes: detail.notes.filter((n) => n.id !== noteId) });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingNoteId(null);
    }
  }

  async function runDestructive() {
    if (!detail || !userId || !destructive) return;
    if (!destructivePassword) {
      setError('Password required');
      return;
    }
    setDestructiveBusy(true);
    setError(null);
    try {
      const token = await getToken();
      const isBan = destructive === 'ban';
      const isUnban = destructive === 'ban' && detail.user.banned;
      const path = isUnban ? 'unban' : isBan ? 'ban' : 'delete';
      const body: Record<string, unknown> = { password: destructivePassword };
      if (isBan && !isUnban && destructiveReason.trim()) body.reason = destructiveReason.trim();

      const res = await fetch(
        `/api/admin/users/${userId}/${path}?token=${encodeURIComponent(token ?? '')}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

      onUpdated();
      if (destructive === 'delete') {
        // User no longer exists — close the sheet.
        onClose();
      } else if (isUnban) {
        setDetail({
          ...detail,
          user: { ...detail.user, banned: false, ban_reason: null },
        });
        setDestructive(null);
        setDestructivePassword('');
        setDestructiveReason('');
      } else {
        setDetail({
          ...detail,
          user: {
            ...detail.user,
            banned: true,
            ban_reason: destructiveReason.trim() || null,
            plan: 'free',
            plan_expiry: null,
          },
        });
        setEditingPlan('free');
        setEditingExpiry(undefined);
        setDestructive(null);
        setDestructivePassword('');
        setDestructiveReason('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setDestructiveBusy(false);
    }
  }

  function cancelDestructive() {
    setDestructive(null);
    setDestructivePassword('');
    setDestructiveReason('');
    setError(null);
  }

  async function unlinkAccount(la: LinkedAccount) {
    if (!detail || !userId) return;
    const key = `${la.platform}:${la.platform_username}`;
    setUnlinkingKey(key);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/users/${userId}/unlink?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: la.platform, platform_username: la.platform_username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Optimistically drop from local state — refetch would re-paint anyway.
      setDetail({
        ...detail,
        linked_accounts: detail.linked_accounts.filter(
          (x) => !(x.platform === la.platform && x.platform_username === la.platform_username),
        ),
      });
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlink failed');
    } finally {
      setUnlinkingKey(null);
    }
  }

  async function sendPasswordReset() {
    if (!userId) return;
    setResetting(true);
    setError(null);
    setResetLink(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/users/${userId}/password-reset?token=${encodeURIComponent(token ?? '')}`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResetLink(json.actionLink || 'sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  const u = detail?.user;
  const planChanged = u && (editingPlan !== u.plan || (editingExpiry?.toISOString() ?? null) !== (u.plan_expiry ?? null));
  const roleChanged = u && editingRole !== u.role;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <SheetHeader className="space-y-0 border-b border-border/50 px-5 py-4">
          <SheetTitle asChild>
            <div className="space-y-3">
              {/* Identity row + 3-dot menu. The close (X) provided by Sheet
                  sits at top-right, so we position the kebab to its left
                  via pr-16 spacing on the title block. */}
              <div className="flex items-start justify-between gap-2 pr-8">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {u?.email ?? (loading ? 'Loading…' : 'User')}
                  </div>
                  {u && (
                    <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <span className="truncate">{u.user_id}</span>
                      <CopyButton value={u.user_id} label="user id" />
                    </div>
                  )}
                </div>

                {u && destructive === null && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="More actions"
                      >
                        <MoreVertical size={15} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDestructive('ban')}>
                        <Ban size={12} />
                        {u.banned ? 'Unban user' : 'Ban user'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDestructive('delete')}>
                        <Trash2 size={12} />
                        Delete account
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              {u && destructive !== null && (
                <DestructiveConfirm
                  kind={destructive}
                  isUnban={destructive === 'ban' && u.banned}
                  password={destructivePassword}
                  reason={destructiveReason}
                  onPassword={setDestructivePassword}
                  onReason={setDestructiveReason}
                  onConfirm={runDestructive}
                  onCancel={cancelDestructive}
                  busy={destructiveBusy}
                />
              )}
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading && !detail && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}

          {u && (
            <>
              {/* ─── Status row ─────────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-transparent capitalize" style={planBadgeStyle(u.plan)}>{u.plan}</Badge>
                <Badge variant={roleVariant(u.role)} className="capitalize">{u.role.replace('_', ' ')}</Badge>
                {u.email_verified ? (
                  <Badge variant="success">verified</Badge>
                ) : (
                  <Badge variant="warning">unverified</Badge>
                )}
                {u.freetrial_used && <Badge variant="muted">trial used</Badge>}
                {u.banned && <Badge variant="destructive">banned</Badge>}
              </div>

              {/* ─── Meta ───────────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <div className="text-muted-foreground">Joined</div>
                  <div className="num mt-0.5 font-medium">{fmt(u.joined_at)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Last sign-in</div>
                  <div className="num mt-0.5 font-medium">{fmt(u.last_sign_in_at)}</div>
                </div>
              </div>

              <Separator />

              {/* ─── Email row ──────────────────────────────────────── */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Mail size={11} /> Email
                </div>
                {emailEdit ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      disabled={savingEmail}
                    />
                    <Button size="sm" onClick={saveEmail} disabled={savingEmail}>
                      {savingEmail ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEmailEdit(false); setNewEmail(u.email); }} disabled={savingEmail}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
                    <span className="truncate text-[12px]">{u.email}</span>
                    <Button size="sm" variant="outline" onClick={() => setEmailEdit(true)}>
                      Change
                    </Button>
                  </div>
                )}
              </div>

              {/* ─── Plan & expiry ──────────────────────────────────── */}
              {(() => {
                // Active Paddle subscription = Paddle owns plan + expiry.
                // Editing them from the dashboard would drift from Paddle
                // and the next webhook would overwrite anyway. Keep the
                // section read-only with the dedicated extend-days flow
                // for the only mutation that makes sense (free days).
                const paddleManaged =
                  !!detail.subscription?.paddle_subscription_id &&
                  detail.subscription.status !== 'canceled' &&
                  !detail.subscription.canceled_at;
                return (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Crown size={11} /> Plan
                  {paddleManaged && (
                    <span className="font-normal normal-case tracking-normal text-amber-500">
                      — managed by Paddle
                    </span>
                  )}
                </div>
                <select
                  value={editingPlan ?? 'free'}
                  onChange={(e) => setEditingPlan(e.target.value as typeof PLANS[number])}
                  className="flex h-9 w-full rounded-md border border-border bg-background/40 px-2 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingPlan || paddleManaged}
                >
                  {PLANS.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
                </select>

                {(() => {
                  // free / lifetime never have an expiry — keep the field
                  // visible but disabled so admins still see what was there.
                  const expiryDisabled = !!editingPlan && PLANS_WITHOUT_EXPIRY.has(editingPlan);
                  // Paddle owns the renewal date for active paid subs.
                  // The "Add days" control below pushes nextBilledAt via
                  // the Paddle SDK — manual date editing is suppressed so
                  // an admin can't drift user_settings out of sync with
                  // Paddle's own state.
                  const isPaddleSub =
                    !!detail.subscription?.paddle_subscription_id &&
                    detail.subscription.status !== 'canceled' &&
                    !detail.subscription.canceled_at &&
                    !expiryDisabled &&
                    editingPlan === u.plan; // only when plan isn't being changed in this session
                  return (
                    <>
                      <div className={cn(
                        'flex items-center gap-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider',
                        expiryDisabled ? 'text-muted-foreground/50' : 'text-muted-foreground',
                      )}>
                        <CalendarIcon size={11} /> Expires
                        {expiryDisabled && (
                          <span className="font-normal normal-case tracking-normal">
                            — not applicable for {editingPlan}
                          </span>
                        )}
                        {isPaddleSub && (
                          <span className="font-normal normal-case tracking-normal text-amber-500">
                            — managed by Paddle
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => !expiryDisabled && !isPaddleSub && setShowCalendar((v) => !v)}
                        disabled={expiryDisabled || isPaddleSub}
                        className={cn(
                          'flex h-9 w-full items-center justify-between rounded-md border border-border bg-background/40 px-3 text-left text-sm transition-colors',
                          (expiryDisabled || isPaddleSub)
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-muted/40',
                        )}
                      >
                        <span className={cn(!editingExpiry && 'text-muted-foreground')}>
                          {editingExpiry ? format(editingExpiry, 'PPP') : 'Pick a date'}
                        </span>
                        <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', showCalendar && 'rotate-180')} />
                      </button>
                      {showCalendar && !expiryDisabled && !isPaddleSub && (
                        <div className="rounded-md border border-border bg-card">
                          <Calendar
                            mode="single"
                            selected={editingExpiry}
                            onSelect={setEditingExpiry}
                          />
                          <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setEditingExpiry(undefined)}
                              className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowCalendar(false)}
                              className="text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              Done
                            </button>
                          </div>
                        </div>
                      )}
                      {isPaddleSub && (
                        <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                          <div className="text-[10px] font-medium text-amber-500">
                            Add free days to this Paddle subscription
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={extendDays}
                              onChange={(e) => {
                                const v = e.target.value;
                                setExtendDays(v === '' ? '' : Math.max(1, Math.min(365, parseInt(v, 10) || 0)));
                                setExtendConfirming(false);
                                setExtendError(null);
                              }}
                              disabled={extendingPaddle || extendConfirming}
                              className="h-8 w-20 rounded-md border border-border bg-background/40 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            />
                            <span className="text-[11px] text-muted-foreground">days</span>
                            {!extendConfirming ? (
                              <Button
                                size="sm"
                                onClick={() => {
                                  setExtendError(null);
                                  setExtendConfirming(true);
                                }}
                                disabled={typeof extendDays !== 'number' || extendDays <= 0}
                              >
                                Add
                              </Button>
                            ) : (
                              <>
                                <Button
                                  size="sm"
                                  onClick={extendPaddle}
                                  disabled={extendingPaddle}
                                >
                                  {extendingPaddle
                                    ? <Loader2 size={12} className="animate-spin" />
                                    : `Confirm +${extendDays}d`}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setExtendConfirming(false);
                                    setExtendError(null);
                                  }}
                                  disabled={extendingPaddle}
                                >
                                  Cancel
                                </Button>
                              </>
                            )}
                          </div>
                          {extendError && (
                            <div className="text-[11px] text-red-500">{extendError}</div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}

                {planChanged && !paddleManaged && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={savePlan} disabled={savingPlan}>
                      {savingPlan ? <Loader2 size={12} className="animate-spin" /> : 'Save plan'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setEditingPlan(u.plan);
                      setEditingExpiry(u.plan_expiry ? new Date(u.plan_expiry) : undefined);
                    }} disabled={savingPlan}>
                      Reset
                    </Button>
                  </div>
                )}
              </div>
              );
              })()}

              {/* ─── Role (super_admin only) ────────────────────────── */}
              {callerRole === 'super_admin' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <ShieldCheck size={11} /> Role
                  </div>
                  <select
                    value={editingRole ?? 'user'}
                    onChange={(e) => setEditingRole(e.target.value as UserRole)}
                    className="flex h-9 w-full rounded-md border border-border bg-background/40 px-2 text-sm capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={savingRole}
                  >
                    {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r.replace('_', ' ')}</option>)}
                  </select>
                  {roleChanged && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveRole} disabled={savingRole}>
                        {savingRole ? <Loader2 size={12} className="animate-spin" /> : 'Save role'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingRole(u.role)} disabled={savingRole}>
                        Reset
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Password reset ─────────────────────────────────── */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Shield size={11} /> Password
                </div>
                <Button size="sm" variant="outline" className="w-full" onClick={sendPasswordReset} disabled={resetting}>
                  {resetting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Send password reset link
                </Button>
                {resetLink && resetLink !== 'sent' && (
                  <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      Recovery link
                    </div>
                    <div className="flex items-start gap-2">
                      <code className="flex-1 break-all text-[10px] text-emerald-300/90">{resetLink}</code>
                      <CopyButton value={resetLink} label="link" />
                    </div>
                  </div>
                )}
                {resetLink === 'sent' && (
                  <p className="text-[11px] text-emerald-400">Reset email sent.</p>
                )}
              </div>

              <Separator />

              {/* ─── Notes ──────────────────────────────────────────── */}
              {/* Notes section is open by default — primary use case in
                  the sheet, so don't hide it behind a click. */}
              <NotesSection
                notes={detail!.notes ?? []}
                newNote={newNote}
                onChange={setNewNote}
                onAdd={addNote}
                adding={addingNote}
                deletingId={deletingNoteId}
                onDelete={deleteNote}
              />

              {/* ─── Inventory ──────────────────────────────────────── */}
              {/* Wheel tokens + rewards. Eager-loaded on sheet open so
                  the count chip in the header is accurate immediately.
                  Super-admin gets grant/revoke buttons inline. */}
              <BoostInventory discordId={u.discord_id} callerRole={callerRole} />

              {/* ─── Linked accounts ────────────────────────────────── */}
              <Section icon={Link2} label="Linked accounts" count={detail!.linked_accounts.length}>
                <div className="space-y-2">
                  {detail!.linked_accounts.map((la) => {
                    const key = `${la.platform}:${la.platform_username}`;
                    return (
                      <LinkedAccountRow
                        key={key}
                        la={la}
                        loading={unlinkingKey === key}
                        onUnlink={() => unlinkAccount(la)}
                      />
                    );
                  })}
                </div>
              </Section>

              {/* ─── IPs ────────────────────────────────────────────── */}
              <Section icon={Globe} label="Signup IPs" count={detail!.ips.length}>
                <div className="space-y-1.5">
                  {detail!.ips.map((ip, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <code className="font-mono text-[11px]">{ip.ip_address}</code>
                        {ip.country && (
                          <Badge variant="muted" className="px-1.5 py-0 text-[9px]">
                            {ip.country_code ? `${ip.country_code} · ` : ''}{ip.country}
                          </Badge>
                        )}
                      </div>
                      <span className="num text-[10px] text-muted-foreground">{fmtDateTime(ip.created_at)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {/* ─── Fingerprints ───────────────────────────────────── */}
              <Section icon={Fingerprint} label="Fingerprints" count={detail!.fingerprints.length}>
                <div className="space-y-1.5">
                  {detail!.fingerprints.map((f, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <code className="truncate font-mono text-[11px]">{f.fingerprint}</code>
                        <CopyButton value={f.fingerprint} label="fingerprint" />
                      </div>
                      <span className="num text-[10px] text-muted-foreground">{fmtDateTime(f.created_at)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {/* ─── Discord ────────────────────────────────────────── */}
              <DiscordSection
                discordId={u.discord_id}
                discordUsername={u.discord_username}
                onForceSync={syncDiscordRoles}
                syncing={syncingRoles}
                syncStatus={syncStatus}
                syncError={syncError}
                callerRole={callerRole}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Destructive confirm panel — password gate for ban/unban/delete ────
function DestructiveConfirm({
  kind, isUnban, password, reason, onPassword, onReason, onConfirm, onCancel, busy,
}: {
  kind: 'ban' | 'delete';
  isUnban: boolean;
  password: string;
  reason: string;
  onPassword: (v: string) => void;
  onReason: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const isDelete = kind === 'delete';
  const title = isDelete ? 'Delete account' : isUnban ? 'Unban user' : 'Ban user';
  const subtitle = isDelete
    ? 'This permanently removes the user and all their data. Cannot be undone.'
    : isUnban
      ? 'Restores the user. Plan is not auto-restored — set it manually if needed.'
      : 'Sets banned flag, downgrades plan to free, and unlinks chess accounts.';

  return (
    <div className={cn(
      'space-y-2 rounded-md border p-3',
      isDelete
        ? 'border-destructive/40 bg-destructive/10'
        : isUnban
          ? 'border-emerald-500/30 bg-emerald-500/10'
          : 'border-amber-500/30 bg-amber-500/10',
    )}>
      <div>
        <div className={cn(
          'flex items-center gap-1.5 text-[12px] font-semibold',
          isDelete ? 'text-destructive' : isUnban ? 'text-emerald-400' : 'text-amber-400',
        )}>
          {isDelete ? <Trash2 size={12} /> : <Ban size={12} />}
          {title}
        </div>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{subtitle}</p>
      </div>

      {kind === 'ban' && !isUnban && (
        <input
          type="text"
          value={reason}
          onChange={(e) => onReason(e.target.value)}
          placeholder="Reason (optional, max 500 chars)"
          maxLength={500}
          disabled={busy}
          className="flex h-8 w-full rounded-md border border-border bg-background/40 px-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      )}

      <input
        type="password"
        value={password}
        onChange={(e) => onPassword(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && password) onConfirm(); }}
        placeholder="Your password"
        autoFocus
        disabled={busy}
        className="flex h-8 w-full rounded-md border border-border bg-background/40 px-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={isDelete ? 'destructive' : 'default'}
          onClick={onConfirm}
          disabled={busy || !password}
          className="flex-1"
        >
          {busy
            ? <Loader2 size={12} className="animate-spin" />
            : isDelete ? <Trash2 size={12} /> : <Ban size={12} />}
          Confirm {title.toLowerCase()}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Notes section — always-open variant of Section ───────────────────
// We use a static (non-collapsible) wrapper because the textarea is the
// primary action in the sheet; hiding it behind a click added a step for
// no real benefit.
function NotesSection({
  notes, newNote, onChange, onAdd, adding, deletingId, onDelete,
}: {
  notes: Note[];
  newNote: string;
  onChange: (v: string) => void;
  onAdd: () => void;
  adding: boolean;
  deletingId: string | null;
  onDelete: (noteId: string) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-[12px] font-medium">
        <MessageSquare size={13} strokeWidth={2.2} className="text-muted-foreground" />
        Notes
        <Badge variant="muted" className="px-1.5 py-0.5 text-[10px]">{notes.length}</Badge>
      </div>
      <div className="space-y-3 p-3">
        <div className="space-y-2">
          <textarea
            value={newNote}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Add a note about this user…"
            rows={3}
            maxLength={5000}
            disabled={adding}
            className="w-full resize-y rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{newNote.length}/5000</span>
            <Button size="sm" onClick={onAdd} disabled={!newNote.trim() || adding}>
              {adding
                ? <Loader2 size={12} className="animate-spin" />
                : <Plus size={12} />}
              Add note
            </Button>
          </div>
        </div>

        {notes.length > 0 && (
          <div className="space-y-2 border-t border-border/40 pt-3">
            {notes.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                loading={deletingId === n.id}
                onDelete={() => onDelete(n.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Note row — shows author + relative time + delete with confirm ─────
// Author display priority: discord_username (when linked) > email > "—".
// Mirrors how the dashboard shows users elsewhere: Discord name is the
// face admins recognize, email is the fallback identifier.
function NoteRow({
  note, loading, onDelete,
}: {
  note: Note;
  loading: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const author = note.author_discord ?? note.author_email ?? '—';
  const isDiscord = !!note.author_discord;

  return (
    <div className="rounded-md border border-border/50 bg-background/30 px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className={cn('truncate font-medium', isDiscord && 'text-[#5865F2]')}>
            {author}
          </span>
          <span className="text-muted-foreground/60">·</span>
          <span className="num text-[10px] text-muted-foreground">
            {fmtDateTime(note.created_at)}
          </span>
        </div>
        {confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDelete}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
            >
              {loading ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={loading}
              className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Cancel"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete note"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/90">
        {note.note}
      </p>
    </div>
  );
}

// ─── Linked account row with two-step unlink confirm ───────────────────
// First click reveals "Confirm?" + a cancel cross. Second click triggers
// the actual unlink — protects against fat-fingers in a list of accounts.
function LinkedAccountRow({
  la, loading, onUnlink,
}: {
  la: LinkedAccount;
  loading: boolean;
  onUnlink: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/50 px-2 py-2">
      {la.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={la.avatar_url} alt="" className="h-7 w-7 rounded-md object-cover" />
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-[10px] uppercase text-muted-foreground">
          {la.platform[0]}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium">{la.platform_username}</span>
          <Badge variant="muted" className="px-1.5 py-0 text-[9px] capitalize">{la.platform}</Badge>
        </div>
        <div className="num mt-0.5 flex gap-2 text-[10px] text-muted-foreground">
          {la.rating_bullet ? <span>blz {la.rating_bullet}</span> : null}
          {la.rating_blitz ? <span>bl {la.rating_blitz}</span> : null}
          {la.rating_rapid ? <span>rpd {la.rating_rapid}</span> : null}
          <span className="opacity-60">· {fmt(la.linked_at)}</span>
        </div>
      </div>

      {confirming ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onUnlink}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Unlink size={11} />}
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={loading}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cancel"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        >
          <Unlink size={11} />
          Unlink
        </button>
      )}
    </div>
  );
}

// ─── Discord profile + force-sync ──────────────────────────────────────
// Surfaces the linked Discord identity (avatar via the resolve endpoint,
// stable across the session via the shared profile cache) and exposes a
// "Sync roles" button super_admins can hit when the bot drifted out of
// sync (e.g. it was down at the time of a plan change). Hidden entirely
// when no Discord is linked — the no-icon-on-list rule matches the
// pattern in users/page.tsx.
function DiscordSection({
  discordId,
  discordUsername,
  onForceSync,
  syncing,
  syncStatus,
  syncError,
  callerRole,
}: {
  discordId: string | null;
  discordUsername: string | null;
  onForceSync: () => void;
  syncing: boolean;
  syncStatus: 'idle' | 'ok' | 'error';
  syncError: string | null;
  callerRole: UserRole;
}) {
  const ids = discordId ? [discordId] : [];
  const profiles = useResolvedDiscordUsers(ids);
  if (!discordId) return null;
  const profile = profiles.get(discordId);
  const avatar = profile?.avatar ?? null;
  const username = discordUsername ?? profile?.username ?? null;
  const canSync = callerRole === 'super_admin';

  return (
    <div className="rounded-md border border-border/50 px-3 py-2">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <UserIcon size={11} /> Discord
      </div>
      <div className="flex items-center gap-2">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="size-7 shrink-0 rounded-full bg-muted" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px] font-medium">
            {username ?? <code className="font-mono">{discordId}</code>}
          </span>
          <code className="truncate font-mono text-[10px] text-muted-foreground">
            {discordId}
          </code>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onForceSync}
          disabled={syncing || !canSync}
          className="h-7 gap-1 px-2"
          title={canSync ? 'Force re-sync of plan + ELO Discord roles' : 'super_admin required'}
        >
          {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Sync roles
        </Button>
      </div>
      {syncStatus === 'ok' && (
        <div className="mt-2 text-[10px] text-emerald-400">Role sync triggered — applied within a few seconds.</div>
      )}
      {syncStatus === 'error' && syncError && (
        <div className="mt-2 text-[10px] text-rose-400">{syncError}</div>
      )}
    </div>
  );
}
