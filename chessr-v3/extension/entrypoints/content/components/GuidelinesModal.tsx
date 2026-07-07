/**
 * GuidelinesModal — one-shot onboarding takeover that teaches the user how
 * to use chessr without getting flagged. Shown the first time an
 * authenticated user is seen with no acceptance stamp (covers both signup
 * and login without hooking the auth events).
 *
 * Interaction (validated with Timothé):
 *   - a vertical list of rule cards; each must be checked before the
 *     "I understand" button unlocks. Acceptance is mandatory — there is NO
 *     ✕ / backdrop close, the modal blocks until accepted.
 *   - on accept we POST /guidelines/accept (DB stamp) and set
 *     guidelinesAcceptedAt locally so it never reopens. The stamp lives in
 *     the DB, not local storage, so it survives reinstalls AND the fresh
 *     Chrome profiles the guidelines themselves tell users to create.
 *   - shows even during a live game — the onboarding is mandatory reading
 *     before the user gets going (unlike the trial-expiry modal, which
 *     defers to avoid interrupting play).
 */

import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { sendWs } from '../lib/websocket';
import { SERVER_URL } from '../lib/config';
import { useTranslation } from '../lib/i18n';
import './guidelines-modal.css';

interface Guideline {
  icon: string;
  key: string;
  link?: { url: string; labelKey: string };
}

const GUIDELINES: Guideline[] = [
  {
    icon: '🌐',
    key: 'chromeProfile',
    link: {
      url: 'https://support.google.com/chrome/answer/2364824',
      labelKey: 'guidelines.card.chromeProfile.link',
    },
  },
  { icon: '📅', key: 'oldAccount' },
  { icon: '📈', key: 'newAccountGrind' },
  { icon: '🧩', key: 'noOtherExtensions' },
  { icon: '🎯', key: 'notFullStrength' },
  {
    icon: '📊',
    key: 'profileAnalysis',
    link: {
      url: 'https://app.chessr.io/profile-analysis',
      labelKey: 'guidelines.card.profileAnalysis.link',
    },
  },
];

export default function GuidelinesModal() {
  const { t } = useTranslation();
  const { user, planLoading, guidelinesAcceptedAt } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<boolean[]>(() => GUIDELINES.map(() => false));
  const [saving, setSaving] = useState(false);
  const shownSent = useRef(false);

  // Eligibility — authenticated, plan loaded, never accepted. Shown even
  // during a live game (validated with Timothé): the onboarding must be
  // read before the user gets going, board or no board.
  useEffect(() => {
    if (open) return;
    if (!user || planLoading || guidelinesAcceptedAt !== null) return;
    setOpen(true);
    if (!shownSent.current) {
      shownSent.current = true;
      sendWs({ type: 'guidelines_modal_shown' });
    }
  }, [open, user?.id, planLoading, guidelinesAcceptedAt]);

  if (!open || !user) return null;

  const allChecked = checked.every(Boolean);

  const toggle = (i: number) =>
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  const accept = async () => {
    if (!allChecked || saving) return;
    setSaving(true);
    sendWs({ type: 'guidelines_modal_accepted' });
    // Optimistic — close immediately, stamp the DB in the background. The
    // endpoint is idempotent, so a failed request just means the modal may
    // reappear on the next plan refetch (acceptable, never a hard error).
    fetch(`${SERVER_URL}/guidelines/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    }).catch(() => {});
    useAuthStore.setState({ guidelinesAcceptedAt: new Date() });
    setOpen(false);
  };

  return (
    <div className="guidelines-backdrop">
      <div className="guidelines-modal" role="dialog" aria-modal="true">
        <div className="guidelines-brand">
          <img src={browser.runtime.getURL('/icons/icon128.png')} alt="Chessr" width={30} height={30} />
          <span className="guidelines-brand-name">Chessr<span className="guidelines-brand-dot">.io</span></span>
        </div>

        <h3 className="guidelines-title">{t('guidelines.title')}</h3>
        <p className="guidelines-subtitle">{t('guidelines.subtitle')}</p>

        <div className="guidelines-list">
          {GUIDELINES.map((g, i) => (
            <label
              key={g.key}
              className={`guidelines-card ${checked[i] ? 'guidelines-card--checked' : ''}`}
            >
              <span className="guidelines-card-icon">{g.icon}</span>
              <span className="guidelines-card-text">
                <span className="guidelines-card-title">{t(`guidelines.card.${g.key}.title`)}</span>
                <span className="guidelines-card-body">{t(`guidelines.card.${g.key}.body`)}</span>
                {g.link && (
                  <a
                    className="guidelines-card-link"
                    href={g.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t(g.link.labelKey)} ↗
                  </a>
                )}
              </span>
              <input
                type="checkbox"
                className="guidelines-card-check"
                checked={checked[i]}
                onChange={() => toggle(i)}
              />
            </label>
          ))}
        </div>

        <button
          className="guidelines-cta"
          onClick={accept}
          disabled={!allChecked || saving}
        >
          {t('guidelines.accept')}
        </button>
        <p className="guidelines-hint">{t('guidelines.hint')}</p>
      </div>
    </div>
  );
}
