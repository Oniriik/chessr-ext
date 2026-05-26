'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Check, ChevronDown, Loader2,
  MessageSquare, Search, Send, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';
import { planBadgeStyle } from '@/lib/plan-colors';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────

type LinkedUser = {
  userId: string;
  discordId: string;
  discordUsername: string | null;
  discordAvatar: string | null;
  email: string | null;
  plan: string;
};

type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
    avatar: string | null;
    discriminator?: string;
  };
  embeds?: { title?: string; description?: string }[];
};

type ModChannel = { name: string; id: string };

// ─── Helpers ──────────────────────────────────────────────────────────────

async function authToken(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? '';
}

function displayName(u: LinkedUser): string {
  return u.discordUsername ?? u.email ?? u.discordId;
}

function avatarUrl(u: LinkedUser): string | null {
  return u.discordAvatar ?? null;
}

function initials(u: LinkedUser): string {
  const name = u.discordUsername ?? u.email ?? u.discordId;
  return name.slice(0, 2).toUpperCase();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function msgPreview(msg: DiscordMessage): string {
  if (msg.content) return msg.content.slice(0, 60);
  if (msg.embeds?.[0]?.title) return msg.embeds[0].title;
  return '(embed)';
}

// ─── Avatar ───────────────────────────────────────────────────────────────

function UserAvatar({ user, size = 28 }: { user: LinkedUser; size?: number }) {
  const url = avatarUrl(user);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={displayName(user)}
      width={size}
      height={size}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0"
      style={{ width: size, height: size }}
    >
      {initials(user)}
    </span>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────

function MessageBubble({ msg, botId }: { msg: DiscordMessage; botId?: string }) {
  const isBot = msg.author.bot || (botId && msg.author.id === botId);
  return (
    <div className={cn('flex gap-2 py-1', isBot ? 'flex-row-reverse' : 'flex-row')}>
      <div
        className={cn(
          'h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0',
          isBot ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        {msg.author.username.slice(0, 2).toUpperCase()}
      </div>
      <div className={cn('max-w-[70%] space-y-0.5', isBot ? 'items-end' : 'items-start')}>
        <div className={cn('flex items-baseline gap-1.5', isBot && 'flex-row-reverse')}>
          <span className="text-[10px] font-semibold">
            {isBot ? 'Chessr' : msg.author.username}
          </span>
          <span className="text-[9px] text-muted-foreground">{relativeTime(msg.timestamp)}</span>
        </div>
        <div
          className={cn(
            'rounded-xl px-3 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap break-words',
            isBot
              ? 'rounded-tr-sm bg-primary/15 text-foreground'
              : 'rounded-tl-sm bg-muted/60 text-foreground',
          )}
        >
          {msg.content || (msg.embeds?.[0] && (
            <span className="italic text-muted-foreground">
              {msg.embeds[0].title ?? '(embed)'}
            </span>
          )) || <span className="italic text-muted-foreground">(empty)</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Discord-style message preview ───────────────────────────────────────

function DmPreview({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-[#2b2d31] p-3 text-[12px]">
      <div className="flex items-start gap-2.5">
        <div className="h-8 w-8 rounded-full bg-primary/30 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">
          CH
        </div>
        <div>
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <span className="text-[12px] font-semibold text-white">Chessr</span>
            <span className="text-[10px] text-[#80848e]">Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-[#dbdee1] whitespace-pre-wrap">
            {content || <span className="italic text-[#80848e]">Type a message to preview…</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Recipient picker (reused in both compose & forward) ─────────────────

function RecipientPicker({
  users,
  selected,
  onChange,
}: {
  users: LinkedUser[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? users.filter(
          (u) =>
            u.email?.toLowerCase().includes(q) ||
            u.discordUsername?.toLowerCase().includes(q),
        )
      : users;
  }, [users, search]);

  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id); else n.add(id);
    onChange(n);
  }
  function selectAll() { onChange(new Set(filtered.map((u) => u.discordId))); }
  function clearAll()  { onChange(new Set()); }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recipients — {selected.size} selected
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] text-primary hover:underline disabled:opacity-40"
            disabled={filtered.length === 0}
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            disabled={selected.size === 0}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by email or username…"
          className="pl-8 h-8 text-[12px]"
        />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/40">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted-foreground">No matches.</div>
        ) : (
          <ul>
            {filtered.map((u, i) => {
              const isOn = selected.has(u.discordId);
              return (
                <li
                  key={u.discordId}
                  onClick={() => toggle(u.discordId)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors',
                    i > 0 && 'border-t border-border/40',
                    isOn ? 'bg-primary/10' : 'hover:bg-muted/40',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors',
                      isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background',
                    )}
                  >
                    {isOn && <Check size={9} strokeWidth={3} />}
                  </span>
                  <UserAvatar user={u} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">{displayName(u)}</div>
                    {u.email && u.discordUsername && (
                      <div className="truncate text-[10px] text-muted-foreground">{u.email}</div>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                    style={planBadgeStyle(u.plan)}
                  >
                    {u.plan}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Forward dialog ───────────────────────────────────────────────────────

function ForwardDialog({
  users,
  onClose,
  token,
}: {
  users: LinkedUser[];
  onClose: () => void;
  token: string;
}) {
  const [tab, setTab]                   = useState<'text' | 'channel'>('text');
  const [freeText, setFreeText]         = useState('');
  const [showPreview, setShowPreview]   = useState(false);

  const [modChannels, setModChannels]   = useState<ModChannel[]>([]);
  const [channelId, setChannelId]       = useState('');
  const [chMessages, setChMessages]     = useState<DiscordMessage[]>([]);
  const [chLoading, setChLoading]       = useState(false);
  const [selectedMsg, setSelectedMsg]   = useState<DiscordMessage | null>(null);

  const [recipients, setRecipients]     = useState<Set<string>>(new Set());
  const [sending, setSending]           = useState(false);
  const [result, setResult]             = useState<{ ok: boolean; text: string } | null>(null);

  // Load mod channels once
  useEffect(() => {
    fetch(`/api/admin/discord/mod-channels?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => setModChannels(d.channels ?? []));
  }, [token]);

  // Load channel messages when channelId changes
  useEffect(() => {
    if (!channelId) return;
    setChLoading(true);
    setChMessages([]);
    setSelectedMsg(null);
    fetch(`/api/admin/discord/channel-messages?token=${encodeURIComponent(token)}&channelId=${encodeURIComponent(channelId)}`)
      .then((r) => r.json())
      .then((d) => setChMessages((d.messages ?? []).reverse()))
      .finally(() => setChLoading(false));
  }, [channelId, token]);

  const content = tab === 'text' ? freeText : (selectedMsg?.content ?? '');

  async function send() {
    if (!content.trim() || recipients.size === 0) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/discord/dm-send?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds: Array.from(recipients), content: content.trim() }),
      });
      const json = await res.json();
      setResult({ ok: res.ok, text: res.ok ? `Sent to ${json.sent}/${json.total} user(s).` : json.error });
      if (res.ok) { setFreeText(''); setSelectedMsg(null); setRecipients(new Set()); }
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setSending(false);
    }
  }

  const canSend = content.trim().length > 0 && recipients.size > 0 && !sending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-border bg-background p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Send size={14} className="text-primary" />
            Forward / Broadcast
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        {/* Source tabs */}
        <div className="inline-flex items-center rounded-md border border-border bg-card/40 p-0.5 w-fit">
          {([
            { id: 'text'    as const, label: 'Free text'       },
            { id: 'channel' as const, label: 'From channel'    },
          ]).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex h-7 items-center rounded px-3 text-[11px] font-medium transition-colors',
                tab === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content area */}
        {tab === 'text' ? (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Message
            </label>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Type your message…"
              rows={4}
              className="w-full resize-y rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-[11px] text-primary hover:underline"
            >
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
            {showPreview && <DmPreview content={freeText} />}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Channel
              </label>
              <div className="relative">
                <select
                  value={channelId}
                  onChange={(e) => setChannelId(e.target.value)}
                  className="w-full appearance-none rounded-md border border-border bg-background/40 px-3 py-2 pr-8 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Select a channel…</option>
                  {modChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name} ({ch.id})</option>
                  ))}
                  <option value="__custom__">Custom channel ID…</option>
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              {channelId === '__custom__' && (
                <Input
                  placeholder="Channel ID…"
                  onChange={(e) => setChannelId(e.target.value)}
                  className="text-[12px]"
                />
              )}
            </div>

            {channelId && channelId !== '__custom__' && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Messages — click to select
                </label>
                <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/40">
                  {chLoading ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted-foreground">
                      <Loader2 size={12} className="animate-spin" />
                      Loading…
                    </div>
                  ) : chMessages.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-muted-foreground">No messages.</div>
                  ) : (
                    <ul>
                      {chMessages.map((msg, i) => {
                        const isSelected = selectedMsg?.id === msg.id;
                        return (
                          <li
                            key={msg.id}
                            onClick={() => setSelectedMsg(isSelected ? null : msg)}
                            className={cn(
                              'cursor-pointer px-3 py-2 transition-colors',
                              i > 0 && 'border-t border-border/40',
                              isSelected ? 'bg-primary/10' : 'hover:bg-muted/40',
                            )}
                          >
                            <div className="flex items-start gap-2">
                              {isSelected && <Check size={11} className="mt-0.5 shrink-0 text-primary" />}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-semibold">{msg.author.username}</span>
                                  <span className="text-[10px] text-muted-foreground">{relativeTime(msg.timestamp)}</span>
                                </div>
                                <p className="truncate text-[11px] text-muted-foreground">{msgPreview(msg)}</p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {selectedMsg && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview
                </label>
                <DmPreview content={selectedMsg.content} />
              </div>
            )}
          </div>
        )}

        {/* Recipients */}
        <RecipientPicker users={users} selected={recipients} onChange={setRecipients} />

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
          <div className="text-[11px]">
            {result && (
              <span className={cn('inline-flex items-center gap-1.5', result.ok ? 'text-emerald-400' : 'text-destructive')}>
                {result.ok ? <Check size={12} /> : <AlertCircle size={12} />}
                {result.text}
              </span>
            )}
          </div>
          <Button onClick={send} disabled={!canSend} size="sm">
            {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            {sending ? 'Sending…' : `Send to ${recipients.size}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────

export function DiscordMessages() {
  const [tk, setTk]                 = useState('');
  const [users, setUsers]           = useState<LinkedUser[]>([]);
  const [usersLoading, setUL]       = useState(true);
  const [search, setSearch]         = useState('');

  const [activeUser, setActiveUser] = useState<LinkedUser | null>(null);
  const [messages, setMessages]     = useState<DiscordMessage[]>([]);
  const [msgsLoading, setML]        = useState(false);

  const [compose, setCompose]       = useState('');
  const [showPreview, setSP]        = useState(false);
  const [sending, setSending]       = useState(false);
  const [sendResult, setSR]         = useState<{ ok: boolean; text: string } | null>(null);

  const [forwardOpen, setFO]        = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth token
  useEffect(() => {
    authToken().then(setTk);
  }, []);

  // Load linked users
  useEffect(() => {
    if (!tk) return;
    setUL(true);
    fetch(`/api/admin/discord/linked-users?token=${encodeURIComponent(tk)}`)
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .finally(() => setUL(false));
  }, [tk]);

  // Load DM history when active user changes
  const loadMessages = useCallback(async (user: LinkedUser, token: string) => {
    setML(true);
    setMessages([]);
    setSR(null);
    const res = await fetch(
      `/api/admin/discord/dm-history?token=${encodeURIComponent(token)}&discordId=${encodeURIComponent(user.discordId)}`,
    );
    const data = await res.json();
    // Discord returns newest-first; reverse for chronological display
    setMessages((data.messages ?? []).reverse());
    setML(false);
  }, []);

  useEffect(() => {
    if (!activeUser || !tk) return;
    loadMessages(activeUser, tk);
  }, [activeUser, tk, loadMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? users.filter(
          (u) =>
            u.email?.toLowerCase().includes(q) ||
            u.discordUsername?.toLowerCase().includes(q),
        )
      : users;
  }, [users, search]);

  async function sendDm() {
    if (!activeUser || !compose.trim() || !tk) return;
    setSending(true);
    setSR(null);
    try {
      const res = await fetch(`/api/admin/discord/dm-send?token=${encodeURIComponent(tk)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds: [activeUser.discordId], content: compose.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSR({ ok: true, text: 'Message sent.' });
      setCompose('');
      setSP(false);
      // Refresh conversation
      await loadMessages(activeUser, tk);
    } catch (err) {
      setSR({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {forwardOpen && (
        <ForwardDialog users={users} onClose={() => setFO(false)} token={tk} />
      )}

      <Card>
        <CardContent className="p-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquare size={12} />
              Discord DMs
              {usersLoading
                ? <Loader2 size={10} className="animate-spin" />
                : <span className="num font-normal normal-case">({users.length} linked)</span>}
            </div>
            <Button variant="outline" size="sm" onClick={() => setFO(true)} className="h-7 text-[11px]">
              <Send size={11} />
              Forward / Broadcast
            </Button>
          </div>

          {/* Body: two-column */}
          <div className="flex" style={{ height: 520 }}>
            {/* ── Left: user list ─────────────────────────────────── */}
            <div className="flex w-64 shrink-0 flex-col border-r border-border">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    className="pl-8 h-7 text-[11px]"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {usersLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" />
                    Loading…
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground">
                    {users.length === 0 ? 'No Discord-linked users.' : 'No matches.'}
                  </div>
                ) : (
                  <ul>
                    {filteredUsers.map((u, i) => {
                      const isActive = activeUser?.discordId === u.discordId;
                      return (
                        <li
                          key={u.discordId}
                          onClick={() => { setActiveUser(u); setCompose(''); setSP(false); }}
                          className={cn(
                            'flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors',
                            i > 0 && 'border-t border-border/40',
                            isActive ? 'bg-primary/10' : 'hover:bg-muted/40',
                          )}
                        >
                          <UserAvatar user={u} size={28} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium">{displayName(u)}</div>
                            {u.email && u.discordUsername && (
                              <div className="truncate text-[10px] text-muted-foreground">{u.email}</div>
                            )}
                          </div>
                          <span
                            className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                            style={planBadgeStyle(u.plan)}
                          >
                            {u.plan.slice(0, 4)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            {/* ── Right: conversation ─────────────────────────────── */}
            <div className="flex flex-1 flex-col min-w-0">
              {!activeUser ? (
                <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                  Select a user to view the conversation.
                </div>
              ) : (
                <>
                  {/* Conversation header */}
                  <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
                    <UserAvatar user={activeUser} size={24} />
                    <div>
                      <div className="text-[12px] font-semibold">{displayName(activeUser)}</div>
                      {activeUser.email && activeUser.discordUsername && (
                        <div className="text-[10px] text-muted-foreground">{activeUser.email}</div>
                      )}
                    </div>
                    <span
                      className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                      style={planBadgeStyle(activeUser.plan)}
                    >
                      {activeUser.plan}
                    </span>
                    <button
                      type="button"
                      onClick={() => loadMessages(activeUser, tk)}
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      title="Refresh"
                    >
                      ↻
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
                    {msgsLoading ? (
                      <div className="flex items-center gap-2 py-8 justify-center text-[12px] text-muted-foreground">
                        <Loader2 size={13} className="animate-spin" />
                        Loading messages…
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-muted-foreground">
                        No DM history with this user yet.
                      </div>
                    ) : (
                      messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* Compose */}
                  <div className="border-t border-border p-3 space-y-2">
                    {showPreview && <DmPreview content={compose} />}
                    <textarea
                      value={compose}
                      onChange={(e) => setCompose(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendDm(); }
                      }}
                      placeholder="Write a DM… (⌘↵ to send)"
                      rows={2}
                      className="w-full resize-none rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSP((v) => !v)}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {showPreview ? 'Hide preview' : 'Preview'}
                        </button>
                        {sendResult && (
                          <span className={cn('inline-flex items-center gap-1 text-[11px]', sendResult.ok ? 'text-emerald-400' : 'text-destructive')}>
                            {sendResult.ok ? <Check size={11} /> : <AlertCircle size={11} />}
                            {sendResult.text}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={sendDm}
                        disabled={!compose.trim() || sending}
                        className="h-7 text-[11px]"
                      >
                        {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                        {sending ? 'Sending…' : 'Send'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
