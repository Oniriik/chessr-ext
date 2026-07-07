/**
 * TrialExpiryModal — loss-aversion overlay shown ONCE when the free trial
 * expires within 24h. A live HH:MM:SS countdown is the centerpiece; the
 * feature grid from TrialModal is reframed as what the user is about to
 * lose, and the CTA goes straight to checkout (the user knows the product
 * by now — no trial to sell anymore).
 *
 * Display rules (validated with Timothé):
 *   - the eligibility check only runs while NO game is in progress — never
 *     interrupt a live game. If a game starts while the modal is open it
 *     hides WITHOUT dismissing and comes back after the game.
 *   - closing it writes a dismiss key to extension storage
 *     (`chessr-trial-expiry-dismissed:<userId>:<expiryISO>`) and the modal
 *     never reopens while that key exists. Keyed per user AND per expiry so
 *     a re-granted trial (new expiry) can show again. browser.storage.local
 *     rather than page localStorage so the dismiss holds across chess.com /
 *     lichess / worldchess (page localStorage is per-origin).
 *   - when the countdown hits 0 the content flips to "trial just ended" —
 *     the peak conversion moment, not the time to auto-close.
 */

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import { usePriceAnnounceStore } from '../stores/priceAnnounceStore';
import { isPreannounceActive } from '../lib/priceIncrease';
import { openBillingPage } from '../lib/openBilling';
import { sendWs } from '../lib/websocket';
import { SERVER_URL } from '../lib/config';
import { FEATURES } from './TrialModal';
import { stampFreeUpgradeShown } from './FreeUpgradeModal';
import PriceIncreasePlans from './PriceIncreasePlans';
import { useTranslation } from '../lib/i18n';
import './trial-modal.css';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const dismissKey = (userId: string, expiry: Date) =>
  `chessr-trial-expiry-dismissed:${userId}:${expiry.toISOString()}`;

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function TrialExpiryModal() {
  const { t } = useTranslation();
  const { user, plan, planExpiry, freetrialEndedAt } = useAuthStore();
  const isPlaying = useGameStore((s) => s.isPlaying);
  const [open, setOpen] = useState(false);
  // True when the modal was opened by the post-downgrade DB stamp rather
  // than the <24h countdown — renders the "trial just ended" content.
  const [endedMode, setEndedMode] = useState(false);
  // True when opened via the header announce icon — no dismiss key written,
  // survives a running game (explicit user intent).
  const [manual, setManual] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const shownSent = useRef(false);
  const endedHandled = useRef(false);
  const expiryMs = planExpiry?.getTime() ?? null;

  // Price-increase announce window (grid 2026-07-12): shared prices state,
  // plus the manual-open request from the header icon for freetrial users
  // (free users' clicks are consumed by FreeUpgradeModal).
  const announcePrices = usePriceAnnounceStore((s) => s.prices);
  const openRequested = usePriceAnnounceStore((s) => s.openRequested);
  const clearOpenRequest = usePriceAnnounceStore((s) => s.clearOpenRequest);
  const refreshAnnounce = usePriceAnnounceStore((s) => s.refresh);
  const announce = isPreannounceActive(announcePrices);

  useEffect(() => {
    if (!openRequested || !user || plan !== 'freetrial') return;
    // clearOpenRequest() flips our own dependency — no cancelled guard here
    // (its cleanup would always abort the open; the component stays mounted).
    clearOpenRequest();
    refreshAnnounce(user.id).then(() => {
      setManual(true);
      setOpen(true);
      sendWs({ type: 'trial_expiry_modal_shown', source: 'header-icon' });
    });
  }, [openRequested, user?.id, plan]);

  // Keep the announce prices fresh while the modal is up (auto-opens can
  // happen before PanelHeader's fetch resolves; refresh() dedupes via TTL).
  useEffect(() => {
    if (!open || !user) return;
    refreshAnnounce(user.id);
  }, [open, user?.id]);

  // Eligibility check — on mount, on state change, and every minute for
  // tabs left open. Only while no game is in progress.
  useEffect(() => {
    if (open) return;
    if (!user || plan !== 'freetrial' || expiryMs === null || isPlaying) return;
    let cancelled = false;
    const check = async () => {
      const left = expiryMs - Date.now();
      if (left <= 0 || left > DAY_MS) return;
      const key = dismissKey(user.id, new Date(expiryMs));
      const stored = await browser.storage.local.get(key);
      if (cancelled || stored[key]) return;
      setOpen(true);
      if (!shownSent.current) {
        shownSent.current = true;
        sendWs({ type: 'trial_expiry_modal_shown' });
      }
    };
    check();
    const iv = setInterval(check, 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [open, user?.id, plan, expiryMs, isPlaying]);

  // Post-downgrade trigger — the plan-expiry sweeper stamped
  // freetrial_ended_at in DB. Show the "trial ended" modal once, ack the
  // stamp immediately (server nulls it — the DB is the once-only guard,
  // it survives reinstalls and covers all devices). A stale stamp (>7d,
  // user didn't play since) or a live-ended dismissal tombstone acks
  // silently without showing.
  useEffect(() => {
    if (open || endedHandled.current) return;
    if (!user || plan !== 'free' || !freetrialEndedAt || isPlaying) return;
    endedHandled.current = true;
    let cancelled = false;
    (async () => {
      const tombKey = `chessr-trial-ended-live-dismissed:${user.id}`;
      const stored = await browser.storage.local.get(tombKey).catch(() => ({} as Record<string, unknown>));
      // Ack regardless of outcome — one-shot either way.
      fetch(`${SERVER_URL}/freetrial/ended-ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      }).catch(() => {});
      useAuthStore.setState({ freetrialEndedAt: null });
      if (cancelled) return;
      const age = Date.now() - freetrialEndedAt.getTime();
      if (stored[tombKey] || age < 0 || age > 7 * DAY_MS) return;
      setEndedMode(true);
      setOpen(true);
      sendWs({ type: 'trial_ended_modal_shown' });
    })();
    return () => { cancelled = true; };
  }, [open, user?.id, plan, freetrialEndedAt?.getTime(), isPlaying]);

  // A game started while the modal was up → hide without dismissing;
  // the check above brings it back after the game. Manual opens are exempt:
  // the user summoned the modal, possibly mid-game.
  useEffect(() => {
    if (isPlaying && open && !manual) setOpen(false);
  }, [isPlaying, open, manual]);

  // 1s countdown tick — only while visible, and only in countdown mode.
  useEffect(() => {
    if (!open || endedMode || expiryMs === null) return;
    const tick = () => setRemaining(Math.max(0, expiryMs - Date.now()));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [open, expiryMs]);

  const dismiss = () => {
    // Manual opens never write the dismiss key — closing a summoned modal
    // must not suppress the automatic <24h showing later.
    if (user && manual) {
      setManual(false);
      setOpen(false);
      return;
    }
    if (user && !endedMode && expiryMs !== null) {
      browser.storage.local.set({ [dismissKey(user.id, new Date(expiryMs))]: Date.now() }).catch(() => {});
      // Dismissed the live "just ended" state (countdown reached zero) —
      // leave a tombstone so the DB-stamp trigger doesn't replay the same
      // news on the next reload once the sweeper stamps the row.
      if (remaining !== null && remaining <= 0) {
        browser.storage.local.set({ [`chessr-trial-ended-live-dismissed:${user.id}`]: Date.now() }).catch(() => {});
      }
    }
    // Dismissing any "ended" state starts the recurring free-upgrade
    // modal's 24h clock — never two takeovers back to back.
    if (user && (endedMode || (remaining !== null && remaining <= 0))) {
      stampFreeUpgradeShown(user.id);
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, user?.id, expiryMs, manual]);

  if (!open) return null;
  if (!endedMode && remaining === null) return null;

  const ended = endedMode || (remaining !== null && remaining <= 0);
  const urgent = remaining !== null && remaining < HOUR_MS;

  const handleCta = () => {
    sendWs({ type: 'trial_expiry_modal_cta', ended });
    dismiss();
    // Same-tab: the modal is a takeover, opening a background tab feels
    // broken. The checkout's `return` param brings the user back here.
    openBillingPage({ sameTab: true });
  };

  return (
    <div className="trial-modal-backdrop" onClick={dismiss}>
      <div className="trial-modal" onClick={(e) => e.stopPropagation()}>
        <button className="trial-modal-close" onClick={dismiss} aria-label="Close">✕</button>

        <div className="trial-modal-brand">
          <img src={browser.runtime.getURL('/icons/icon128.png')} alt="Chessr" width={32} height={32} />
          <span className="trial-modal-brand-name">chessr<span className="trial-modal-brand-dot">.io</span></span>
        </div>
        {ended ? (
          <>
            <h3 className="trial-modal-title">{t('trial.expiry.endedTitle')}</h3>
            <p className="trial-modal-subtitle">{t('trial.expiry.endedBody')}</p>
          </>
        ) : (
          <>
            <h3 className="trial-modal-title">{t('trial.expiry.title')}</h3>
            <div className={`trial-modal-countdown ${urgent ? 'trial-modal-countdown--urgent' : ''}`}>
              {formatCountdown(remaining ?? 0)}
            </div>
            <p className="trial-modal-subtitle">{t('trial.expiry.lose')}</p>
          </>
        )}

        <ul className="trial-modal-features">
          {FEATURES.map((f) => (
            <li key={f.key}>
              <span className="trial-modal-feature-icon">{f.icon}</span>
              <span>{t(f.key)}</span>
            </li>
          ))}
        </ul>

        {announce && announcePrices?.upcoming && (
          <>
            <p className="trial-modal-increase-note">{t('upgrade.increase.title')}</p>
            <PriceIncreasePlans prices={announcePrices} />
          </>
        )}

        <button className="trial-modal-cta trial-modal-cta--gold" onClick={handleCta}>
          {t('game.review.upgrade')}
        </button>

        <button className="trial-modal-alt" onClick={dismiss}>
          {t('trial.expiry.dismiss')}
        </button>
      </div>
    </div>
  );
}
