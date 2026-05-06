'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Eraser, AlertCircle } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { colorizeLogLine } from '@/lib/logColorize';
import { AdminShell } from '@/components/AdminShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const MAX_LINES = 5000;
const STICK_THRESHOLD_PX = 60;

export default function LogsPage() {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState(true);  // tail-follow on by default

  const scrollerRef = useRef<HTMLDivElement>(null);
  // `pinnedRef` mirrors `pinned` for the scroll handler's closure-free path;
  // the React state drives the "Jump to latest" button visibility.
  const pinnedRef = useRef(true);
  // Set true while we programmatically set scrollTop, so the scroll event
  // it fires doesn't get interpreted as a user-driven scroll-away (which
  // would race with the buffer flood at first mount and falsely unstick).
  const programmaticScrollRef = useRef(false);

  // ─── Stream connection ──────────────────────────────────────────────
  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      es = new EventSource(`/api/logs/stream?token=${encodeURIComponent(token)}`);
      es.onopen = () => { setConnected(true); setError(null); };
      es.onmessage = (ev) => {
        setLines((prev) => {
          const next = prev.length >= MAX_LINES ? [...prev.slice(-MAX_LINES + 1), ev.data] : [...prev, ev.data];
          return next;
        });
      };
      es.onerror = () => { setConnected(false); setError('Stream disconnected'); };
    })();
    return () => { cancelled = true; es?.close(); };
  }, []);

  // Tail-follow: snap to bottom on each new line, but only while the
  // user is parked at the bottom. As soon as they scroll up we release
  // the lock so they can read history undisturbed.
  //
  // No rAF cleanup here — when new lines arrive faster than ~16ms (SSE
  // buffer flood), an effect-cleanup that cancels its own rAF would
  // cancel every pending frame and we'd never actually scroll. Letting
  // them stack is fine: each one targets `el.scrollHeight` which always
  // resolves to the current bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pinnedRef.current) return;
    requestAnimationFrame(() => {
      if (!pinnedRef.current) return;          // user scrolled away meanwhile
      programmaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      requestAnimationFrame(() => { programmaticScrollRef.current = false; });
    });
  }, [lines]);

  // Detect user-driven scroll via wheel / touch / keyboard. We can't
  // rely on the generic scroll event because it also fires for our own
  // programmatic scrollTop assignments — and the timing differs across
  // browsers, so any flag-based filter races. Wheel/touch/keydown only
  // fire on actual input, so we're never confused.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const checkPin = () => {
      requestAnimationFrame(() => {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        const atBottom = dist < STICK_THRESHOLD_PX;
        pinnedRef.current = atBottom;
        setPinned((prev) => (prev !== atBottom ? atBottom : prev));
      });
    };
    el.addEventListener('wheel', checkPin, { passive: true });
    el.addEventListener('touchmove', checkPin, { passive: true });
    el.addEventListener('keydown', checkPin);
    return () => {
      el.removeEventListener('wheel', checkPin);
      el.removeEventListener('touchmove', checkPin);
      el.removeEventListener('keydown', checkPin);
    };
  }, []);

  function jumpToLatest() {
    const el = scrollerRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  }

  function clearLines() {
    setLines([]);
    pinnedRef.current = true;
    setPinned(true);
  }

  return (
    <AdminShell title="Logs">
      {/* The page is a flex column that fully fills the AdminShell body.
       *  The toolbar is `shrink-0`; the log container is `flex-1` with
       *  internal overflow — no window-level scrollbar appears no matter
       *  how many lines we accumulate. */}
      <div className="flex h-full flex-col gap-3">

        {/* ─── Toolbar ─────────────────────────────────────────────── */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[10px] font-medium uppercase tracking-wider',
                connected
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-destructive/30 bg-destructive/10 text-destructive',
              )}
            >
              <span className={cn(
                'inline-block h-2 w-2 rounded-full',
                connected ? 'bg-emerald-400 pulse-dot' : 'bg-destructive',
              )} />
              {connected ? 'Live' : 'Offline'}
            </span>
            <span className="num text-[11px] tabular-nums text-muted-foreground">
              {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              {lines.length === MAX_LINES && <span className="ml-1 text-amber-400">(buffer full)</span>}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!pinned && (
              <Button variant="outline" size="sm" onClick={jumpToLatest} className="gap-1">
                <ArrowDown size={13} />
                Jump to latest
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={clearLines} className="gap-1">
              <Eraser size={13} />
              Clear
            </Button>
          </div>
        </div>

        {error && (
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* ─── Log scroller ────────────────────────────────────────── */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-[#06060d]">
          <div
            ref={scrollerRef}
            className="h-full overflow-y-auto overflow-x-auto px-4 py-3 font-mono text-[12px] leading-[1.55]"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            {lines.length === 0 ? (
              <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
                Waiting for log events…
              </div>
            ) : (
              lines.map((l, i) => (
                <div key={i} className="hover:bg-white/[0.02]">
                  {colorizeLogLine(l)}
                </div>
              ))
            )}
          </div>

          {/* Floating "Jump to latest" pill — only shows when paused
           *  and there's something below the viewport. */}
          {!pinned && lines.length > 0 && (
            <button
              onClick={jumpToLatest}
              className={cn(
                'absolute bottom-3 left-1/2 -translate-x-1/2',
                'inline-flex items-center gap-1.5 rounded-full',
                'border border-primary/40 bg-primary/15 px-3 py-1.5',
                'text-[11px] font-medium text-primary backdrop-blur',
                'shadow-lg shadow-black/40 transition-all hover:bg-primary/20',
              )}
            >
              <ArrowDown size={11} />
              Jump to latest
            </button>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
