import { useEffect, useState } from 'react';
import { useWidgetStore, type SystemMessage } from '../stores/widgetStore';
import { useDiscordStore } from '../stores/discordStore';
import { useAuthStore } from '../stores/authStore';
import { markDismissed } from '../lib/howtos';
import { useTranslation } from '../lib/i18n';

/**
 * Bottom-left floating widget showing one system message at a time.
 * Slides in from the left edge when there's something to display, then
 * out the same way on dismiss. Lives in the React tree and renders into
 * the App's shadow DOM (no fixed-portal needed — its position: fixed
 * inside the shadow already escapes the page layout).
 */

const DISCORD_INVITE_URL = 'https://discord.gg/72j4dUadTu';

export function SystemMessageWidget() {
  const { t } = useTranslation();
  const current = useWidgetStore((s) => s.current);
  const next = useWidgetStore((s) => s.next);
  const remove = useWidgetStore((s) => s.remove);
  const initLink = useDiscordStore((s) => s.initLink);
  const user = useAuthStore((s) => s.user);

  const ACCENT: Record<SystemMessage['category'], { label: string; bar: string; text: string; cta: string }> = {
    info:    { label: t('sys.label.info'),    bar: '#60a5fa', text: '#93c5fd', cta: '#3b82f6' },
    discord: { label: t('sys.label.discord'), bar: '#5865F2', text: '#a3acff', cta: '#5865F2' },
    trial:   { label: t('sys.label.trial'),   bar: '#f59e0b', text: '#fcd34d', cta: '#f59e0b' },
    admin:   { label: t('sys.label.admin'),   bar: '#a855f7', text: '#d8b4fe', cta: '#a855f7' },
    howto:   { label: t('sys.label.howto'),   bar: '#10b981', text: '#6ee7b7', cta: '#10b981' },
  };

  // Drive the slide-in/out: render the latest message even after it's
  // been removed for one frame so the slide-out animation can play.
  // `visible` flips false → next() runs → animation cleanup.
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState<SystemMessage | null>(null);

  useEffect(() => {
    if (current && current.id !== mounted?.id) {
      // New message — mount it and slide in next frame.
      setMounted(current);
      requestAnimationFrame(() => setVisible(true));
      return;
    }
    if (!current && mounted) {
      // Cleared — slide out, then unmount.
      setVisible(false);
      const t = setTimeout(() => setMounted(null), 280);
      return () => clearTimeout(t);
    }
    return;
  }, [current, mounted?.id]);

  // Auto-dismiss timer for messages that ship a `ttl`.
  useEffect(() => {
    if (!current?.ttl) return;
    const t = setTimeout(() => next(), current.ttl);
    return () => clearTimeout(t);
  }, [current, next]);

  if (!mounted) return null;

  // Drop one message — also persists the dismissal for how-to tips so
  // the user doesn't see the same one again next session.
  const dismiss = (id: string, category: SystemMessage['category']) => {
    if (category === 'howto') markDismissed(id);
    remove(id);
  };

  const onCta = () => {
    const a = mounted.cta?.action;
    if (!a) return;
    switch (a.kind) {
      case 'discord-link':
        if (user) initLink(user.id);
        break;
      case 'discord-join':
      case 'open-url':
        window.open(a.url || DISCORD_INVITE_URL, '_blank', 'noopener,noreferrer');
        break;
      case 'open-tab':
        // Surface a custom event the App can listen to and route — keeps
        // the widget store unaware of which UI tabs exist.
        window.dispatchEvent(new CustomEvent('chessr:open-tab', { detail: { tab: a.tab } }));
        break;
      case 'open-stream':
        // Re-uses the same background message the Settings card fires —
        // the background script handles tab creation / focus.
        browser.runtime.sendMessage({ type: 'open_stream' }).catch(() => {});
        break;
      case 'toggle-edit-layout':
        // App.tsx listens for this and opens the panel + flips
        // layoutStore.editMode — keeps the widget free of store deps.
        window.dispatchEvent(new CustomEvent('chessr:toggle-edit-layout'));
        break;
      case 'dismiss':
      default:
        break;
    }
    dismiss(mounted.id, mounted.category);
  };

  const accent = ACCENT[mounted.category];

  return (
    <div
      className={`chessr-sysmsg ${visible ? 'chessr-sysmsg--visible' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="chessr-sysmsg-stripe" style={{ background: accent.bar }} />
      <div className="chessr-sysmsg-body">
        <div className="chessr-sysmsg-header">
          <span className="chessr-sysmsg-cat" style={{ color: accent.text }}>
            {accent.label}
          </span>
          <button
            className="chessr-sysmsg-close"
            onClick={() => dismiss(mounted.id, mounted.category)}
            aria-label={t('sys.dismiss')}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="chessr-sysmsg-title">{mounted.title}</div>
        {mounted.body && <div className="chessr-sysmsg-text">{mounted.body}</div>}
        {mounted.cta && (
          <button
            className="chessr-sysmsg-cta"
            onClick={onCta}
            type="button"
            style={{ background: accent.cta }}
          >
            {mounted.cta.label}
          </button>
        )}
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

