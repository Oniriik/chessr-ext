'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Check, ChevronDown, Loader2,
  MessageSquare, RefreshCw, Search, Send, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabase } from '@/lib/supabase';
import { planBadgeStyle } from '@/lib/plan-colors';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────

/** A tracked conversation — populated when the bot sends or receives a DM. */
type DmThread = {
  discordId:           string;
  channelId:           string | null;
  lastInboundAt:       string | null;  // user → bot
  lastInboundPreview:  string | null;
  lastOutboundAt:      string | null;  // bot → user
  lastOutboundPreview: string | null;
  updatedAt:           string;
  discordUsername:     string | null;
  discordAvatar:       string | null;
  email:               string | null;
  plan:                string;
};

/** All Discord-linked users — used only for the recipient picker. */
type LinkedUser = {
  userId:          string;
  discordId:       string;
  discordUsername: string | null;
  discordAvatar:   string | null;
  email:           string | null;
  plan:            string;
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
  };
  embeds?: { title?: string; description?: string }[];
};

type ModChannel = { name: string; id: string };

// ─── Unread tracking (localStorage) ──────────────────────────────────────

function isUnread(thread: DmThread): boolean {
  if (!thread.lastInboundAt) return false;
  try {
    const raw = localStorage.getItem(`discord_read_${thread.discordId}`);
    if (!raw) return true;
    return new Date(thread.lastInboundAt) > new Date(raw);
  } catch {
    return false;
  }
}

function markRead(discordId: string): void {
  try {
    localStorage.setItem(`discord_read_${discordId}`, new Date().toISOString());
  } catch { /* ignore */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function authToken(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? '';
}

function threadDisplayName(t: DmThread): string {
  return t.discordUsername ?? t.email ?? t.discordId;
}

function userDisplayName(u: LinkedUser): string {
  return u.discordUsername ?? u.email ?? u.discordId;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)     return 'Just now';
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function msgPreview(msg: DiscordMessage): string {
  if (msg.content)          return msg.content.slice(0, 60);
  if (msg.embeds?.[0]?.title) return msg.embeds[0].title;
  return '(embed)';
}

// ─── Avatar ───────────────────────────────────────────────────────────────

function Avatar({
  avatarUrl, name, size = 28,
}: { avatarUrl: string | null; name: string; size?: number }) {
  const initials = name.slice(0, 2).toUpperCase();
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl} alt={name} width={size} height={size}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: DiscordMessage }) {
  const isBot = !!msg.author.bot;
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
      <div className={cn('max-w-[72%] space-y-0.5', isBot ? 'items-end' : 'items-start')}>
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

// ─── Discord-style preview ────────────────────────────────────────────────

function DmPreview({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-[#2b2d31] p-3 text-[12px]">
      <div className="flex items-start gap-2.5">
        <div className="h-8 w-8 rounded-full bg-primary/30 flex items-center justify-center text-[11px] font-bold text-primary shrink-0">CH</div>
        <div>
          <div className="flex items-baseline gap-1.5 mb-0.5">
            <span className="text-[12px] font-semibold text-white">Chessr</span>
            <span className="text-[10px] text-[#80848e]">
              Today at {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-[#dbdee1] whitespace-pre-wrap">
            {content || <span className="italic text-[#80848e]">Type a message to preview…</span>}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Recipient picker ─────────────────────────────────────────────────────

function RecipientPicker({
  users, selected, onChange,
}: {
  users: LinkedUser[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? users.filter((u) =>
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Recipients — {selected.size} selected
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange(new Set(filtered.map((u) => u.discordId)))}
            className="text-[10px] text-primary hover:underline disabled:opacity-40" disabled={!filtered.length}>
            Select all
          </button>
          <button type="button" onClick={() => onChange(new Set())}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={!selected.size}>
            Clear
          </button>
        </div>
      </div>
      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by email or username…" className="pl-8 h-8 text-[12px]" />
      </div>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/40">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted-foreground">No matches.</div>
        ) : (
          <ul>
            {filtered.map((u, i) => {
              const isOn = selected.has(u.discordId);
              return (
                <li key={u.discordId} onClick={() => toggle(u.discordId)}
                  className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 transition-colors',
                    i > 0 && 'border-t border-border/40',
                    isOn ? 'bg-primary/10' : 'hover:bg-muted/40')}>
                  <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors',
                    isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background')}>
                    {isOn && <Check size={9} strokeWidth={3} />}
                  </span>
                  <Avatar avatarUrl={u.discordAvatar} name={userDisplayName(u)} size={20} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">{userDisplayName(u)}</div>
                    {u.email && u.discordUsername && (
                      <div className="truncate text-[10px] text-muted-foreground">{u.email}</div>
                    )}
                  </div>
                  <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                    style={planBadgeStyle(u.plan)}>{u.plan}</span>
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

function ForwardDialog({ users, onClose, token }: {
  users: LinkedUser[];
  onClose: () => void;
  token: string;
}) {
  const [tab, setTab]               = useState<'text' | 'channel'>('text');
  const [freeText, setFreeText]     = useState('');
  const [showPreview, setShowPrev]  = useState(false);
  const [modChannels, setMod]       = useState<ModChannel[]>([]);
  const [channelId, setChannelId]   = useState('');
  const [customId, setCustomId]     = useState('');
  const [chMessages, setChMsgs]     = useState<DiscordMessage[]>([]);
  const [chLoading, setChLoad]      = useState(false);
  const [selectedMsg, setSelMsg]    = useState<DiscordMessage | null>(null);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [sending, setSending]       = useState(false);
  const [result, setResult]         = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/discord/mod-channels?token=${encodeURIComponent(token)}`)
      .then((r) => r.json()).then((d) => setMod(d.channels ?? []));
  }, [token]);

  const resolvedChannelId = channelId === '__custom__' ? customId : channelId;

  useEffect(() => {
    if (!resolvedChannelId || channelId === '__custom__') return;
    setChLoad(true); setChMsgs([]); setSelMsg(null);
    fetch(`/api/admin/discord/channel-messages?token=${encodeURIComponent(token)}&channelId=${encodeURIComponent(resolvedChannelId)}`)
      .then((r) => r.json()).then((d) => setChMsgs((d.messages ?? []).reverse()))
      .finally(() => setChLoad(false));
  }, [resolvedChannelId, channelId, token]);

  const content = tab === 'text' ? freeText : (selectedMsg?.content ?? '');

  async function send() {
    if (!content.trim() || !recipients.size) return;
    setSending(true); setResult(null);
    try {
      const res = await fetch(`/api/admin/discord/dm-send?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds: [...recipients], content: content.trim() }),
      });
      const json = await res.json();
      setResult({ ok: res.ok, text: res.ok ? `Sent to ${json.sent}/${json.total}.` : json.error });
      if (res.ok) { setFreeText(''); setSelMsg(null); setRecipients(new Set()); }
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-border bg-background p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Send size={14} className="text-primary" />Forward / Broadcast
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="inline-flex items-center rounded-md border border-border bg-card/40 p-0.5 w-fit">
          {([{ id: 'text' as const, label: 'Free text' }, { id: 'channel' as const, label: 'From channel' }]).map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={cn('inline-flex h-7 items-center rounded px-3 text-[11px] font-medium transition-colors',
                tab === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'text' ? (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Message</label>
            <textarea value={freeText} onChange={(e) => setFreeText(e.target.value)}
              placeholder="Type your message…" rows={4}
              className="w-full resize-y rounded-md border border-border bg-background/40 px-3 py-2 text-[12px] placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <button type="button" onClick={() => setShowPrev((v) => !v)} className="text-[11px] text-primary hover:underline">
              {showPreview ? 'Hide preview' : 'Show preview'}
            </button>
            {showPreview && <DmPreview content={freeText} />}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Channel</label>
              <div className="relative">
                <select value={channelId} onChange={(e) => setChannelId(e.target.value)}
                  className="w-full appearance-none rounded-md border border-border bg-background/40 px-3 py-2 pr-8 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <option value="">Select a channel…</option>
                  {modChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>{ch.name} ({ch.id})</option>
                  ))}
                  <option value="__custom__">Custom channel ID…</option>
                </select>
                <ChevronDown size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              {channelId === '__custom__' && (
                <Input value={customId} onChange={(e) => setCustomId(e.target.value)}
                  placeholder="Channel ID…" className="text-[12px]" />
              )}
            </div>
            {resolvedChannelId && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Messages — click to select
                </label>
                <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/40">
                  {chLoading ? (
                    <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted-foreground"><Loader2 size={12} className="animate-spin" />Loading…</div>
                  ) : chMessages.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-muted-foreground">No messages.</div>
                  ) : chMessages.map((msg, i) => {
                    const isSel = selectedMsg?.id === msg.id;
                    return (
                      <div key={msg.id} onClick={() => setSelMsg(isSel ? null : msg)}
                        className={cn('cursor-pointer px-3 py-2 transition-colors', i > 0 && 'border-t border-border/40', isSel ? 'bg-primary/10' : 'hover:bg-muted/40')}>
                        <div className="flex items-start gap-2">
                          {isSel && <Check size={11} className="mt-0.5 shrink-0 text-primary" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-semibold">{msg.author.username}</span>
                              <span className="text-[10px] text-muted-foreground">{relativeTime(msg.timestamp)}</span>
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">{msgPreview(msg)}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {selectedMsg && <><label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</label><DmPreview content={selectedMsg.content} /></>}
          </div>
        )}

        <RecipientPicker users={users} selected={recipients} onChange={setRecipients} />

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
          <div className="text-[11px]">
            {result && (
              <span className={cn('inline-flex items-center gap-1.5', result.ok ? 'text-emerald-400' : 'text-destructive')}>
                {result.ok ? <Check size={12} /> : <AlertCircle size={12} />}
                {result.text}
              </span>
            )}
          </div>
          <Button onClick={send} disabled={!content.trim() || !recipients.size || sending} size="sm">
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
  const [tk, setTk]                   = useState('');

  // Conversation list (threads with open DMs)
  const [threads, setThreads]         = useState<DmThread[]>([]);
  const [threadsLoading, setTL]       = useState(true);
  const [search, setSearch]           = useState('');

  // All linked users — for the Forward recipient picker only
  const [linkedUsers, setLinked]      = useState<LinkedUser[]>([]);

  // Unread set — recalculated after loading / after marking read
  const [unreadSet, setUnreadSet]     = useState<Set<string>>(new Set());

  const [activeThread, setActive]     = useState<DmThread | null>(null);
  const [messages, setMessages]       = useState<DiscordMessage[]>([]);
  const [msgsLoading, setML]          = useState(false);

  const [compose, setCompose]         = useState('');
  const [showPreview, setSP]          = useState(false);
  const [sending, setSending]         = useState(false);
  const [sendResult, setSR]           = useState<{ ok: boolean; text: string } | null>(null);

  const [forwardOpen, setFO]          = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth token
  useEffect(() => { authToken().then(setTk); }, []);

  // Compute unread set from threads
  function refreshUnread(ts: DmThread[]) {
    setUnreadSet(new Set(ts.filter(isUnread).map((t) => t.discordId)));
  }

  // Load threads
  const loadThreads = useCallback(async (token: string) => {
    setTL(true);
    const res = await fetch(`/api/admin/discord/threads?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    const ts = (data.threads ?? []) as DmThread[];
    setThreads(ts);
    refreshUnread(ts);
    setTL(false);
  }, []);

  // Load all linked users (for forward dialog)
  const loadLinkedUsers = useCallback(async (token: string) => {
    const res = await fetch(`/api/admin/discord/linked-users?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    setLinked(data.users ?? []);
  }, []);

  useEffect(() => {
    if (!tk) return;
    loadThreads(tk);
    loadLinkedUsers(tk);
  }, [tk, loadThreads, loadLinkedUsers]);

  // Load DM history
  const loadMessages = useCallback(async (thread: DmThread, token: string) => {
    setML(true);
    setMessages([]);
    setSR(null);
    const res = await fetch(
      `/api/admin/discord/dm-history?token=${encodeURIComponent(token)}&discordId=${encodeURIComponent(thread.discordId)}`,
    );
    const data = await res.json();
    // Discord returns newest-first → reverse for chronological display
    setMessages((data.messages ?? []).reverse());
    setML(false);
  }, []);

  useEffect(() => {
    if (!activeThread || !tk) return;
    loadMessages(activeThread, tk);
  }, [activeThread, tk, loadMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const filteredThreads = useMemo(() => {
    const q = search.toLowerCase();
    return q
      ? threads.filter((t) =>
          t.email?.toLowerCase().includes(q) ||
          t.discordUsername?.toLowerCase().includes(q),
        )
      : threads;
  }, [threads, search]);

  function openThread(t: DmThread) {
    setActive(t);
    setCompose('');
    setSP(false);
    // Mark as read
    markRead(t.discordId);
    setUnreadSet((prev) => { const n = new Set(prev); n.delete(t.discordId); return n; });
  }

  async function sendDm() {
    if (!activeThread || !compose.trim() || !tk) return;
    setSending(true); setSR(null);
    try {
      const res = await fetch(`/api/admin/discord/dm-send?token=${encodeURIComponent(tk)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordIds: [activeThread.discordId], content: compose.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSR({ ok: true, text: 'Sent.' });
      setCompose(''); setSP(false);
      await loadMessages(activeThread, tk);
    } catch (err) {
      setSR({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally { setSending(false); }
  }

  const totalUnread = unreadSet.size;

  return (
    <>
      {forwardOpen && (
        <ForwardDialog users={linkedUsers} onClose={() => setFO(false)} token={tk} />
      )}

      <Card>
        <CardContent className="p-0">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <MessageSquare size={12} />
              Discord DMs
              {threadsLoading
                ? <Loader2 size={10} className="animate-spin" />
                : <span className="num font-normal normal-case">
                    ({threads.length} conv{threads.length !== 1 ? 's' : ''})
                  </span>}
              {totalUnread > 0 && (
                <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[9px] font-bold text-destructive-foreground">
                  {totalUnread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => tk && loadThreads(tk)}
                disabled={threadsLoading}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                title="Refresh conversations"
              >
                <RefreshCw size={13} className={threadsLoading ? 'animate-spin' : ''} />
              </button>
              <Button variant="outline" size="sm" onClick={() => setFO(true)} className="h-7 text-[11px]">
                <Send size={11} />
                Forward / Broadcast
              </Button>
            </div>
          </div>

          {/* Two-column body */}
          <div className="flex" style={{ height: 520 }}>
            {/* ── Left: conversation list ──────────────────────────── */}
            <div className="flex w-64 shrink-0 flex-col border-r border-border">
              <div className="border-b border-border p-2">
                <div className="relative">
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…" className="pl-8 h-7 text-[11px]" />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {threadsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-[12px] text-muted-foreground">
                    <Loader2 size={12} className="animate-spin" />Loading…
                  </div>
                ) : filteredThreads.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-muted-foreground">
                    {threads.length === 0
                      ? 'No conversations yet. They appear here once the bot sends or receives a DM.'
                      : 'No matches.'}
                  </div>
                ) : filteredThreads.map((t, i) => {
                  const isActive  = activeThread?.discordId === t.discordId;
                  const hasUnread = unreadSet.has(t.discordId);
                  const lastMsg   = t.lastInboundAt && t.lastOutboundAt
                    ? new Date(t.lastInboundAt) > new Date(t.lastOutboundAt)
                      ? { preview: t.lastInboundPreview, at: t.lastInboundAt, from: 'user' }
                      : { preview: t.lastOutboundPreview, at: t.lastOutboundAt, from: 'bot' }
                    : t.lastInboundAt
                      ? { preview: t.lastInboundPreview, at: t.lastInboundAt, from: 'user' }
                      : t.lastOutboundAt
                        ? { preview: t.lastOutboundPreview, at: t.lastOutboundAt, from: 'bot' }
                        : null;

                  return (
                    <div
                      key={t.discordId}
                      onClick={() => openThread(t)}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors',
                        i > 0 && 'border-t border-border/40',
                        isActive ? 'bg-primary/10' : 'hover:bg-muted/40',
                      )}
                    >
                      <div className="relative shrink-0">
                        <Avatar avatarUrl={t.discordAvatar} name={threadDisplayName(t)} size={28} />
                        {hasUnread && (
                          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn('truncate text-[12px]', hasUnread ? 'font-semibold' : 'font-medium')}>
                            {threadDisplayName(t)}
                          </span>
                          {lastMsg && (
                            <span className="shrink-0 text-[9px] text-muted-foreground">{relativeTime(lastMsg.at)}</span>
                          )}
                        </div>
                        {lastMsg ? (
                          <p className={cn('truncate text-[10px]', hasUnread ? 'text-foreground' : 'text-muted-foreground')}>
                            {lastMsg.from === 'bot' ? '→ ' : '← '}
                            {lastMsg.preview ?? '…'}
                          </p>
                        ) : (
                          <p className="text-[10px] text-muted-foreground/60 italic">No messages yet</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Right: conversation view ─────────────────────────── */}
            <div className="flex flex-1 flex-col min-w-0">
              {!activeThread ? (
                <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground">
                  {threads.length === 0
                    ? 'Conversations appear here once the bot sends or receives a DM.'
                    : 'Select a conversation.'}
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
                    <Avatar avatarUrl={activeThread.discordAvatar} name={threadDisplayName(activeThread)} size={24} />
                    <div>
                      <div className="text-[12px] font-semibold">{threadDisplayName(activeThread)}</div>
                      {activeThread.email && activeThread.discordUsername && (
                        <div className="text-[10px] text-muted-foreground">{activeThread.email}</div>
                      )}
                    </div>
                    <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider"
                      style={planBadgeStyle(activeThread.plan)}>{activeThread.plan}</span>
                    <button type="button" onClick={() => loadMessages(activeThread, tk)}
                      title="Refresh" className="text-muted-foreground hover:text-foreground">
                      <RefreshCw size={12} className={msgsLoading ? 'animate-spin' : ''} />
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
                    {msgsLoading ? (
                      <div className="flex items-center gap-2 py-8 justify-center text-[12px] text-muted-foreground">
                        <Loader2 size={13} className="animate-spin" />Loading messages…
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="py-8 text-center text-[12px] text-muted-foreground">
                        No DM history with this user yet.
                      </div>
                    ) : messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
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
                        <button type="button" onClick={() => setSP((v) => !v)}
                          className="text-[11px] text-primary hover:underline">
                          {showPreview ? 'Hide preview' : 'Preview'}
                        </button>
                        {sendResult && (
                          <span className={cn('inline-flex items-center gap-1 text-[11px]',
                            sendResult.ok ? 'text-emerald-400' : 'text-destructive')}>
                            {sendResult.ok ? <Check size={11} /> : <AlertCircle size={11} />}
                            {sendResult.text}
                          </span>
                        )}
                      </div>
                      <Button size="sm" onClick={sendDm}
                        disabled={!compose.trim() || sending} className="h-7 text-[11px]">
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
