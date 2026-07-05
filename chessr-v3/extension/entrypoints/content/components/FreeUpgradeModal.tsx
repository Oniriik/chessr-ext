/**
 * FreeUpgradeModal — recurring upgrade takeover for free-plan users:
 * shows at most once every 24h (extension-storage timestamp, per user).
 *
 * Coordination rules:
 *   - the 24h stamp is written at OPEN (a reload with the modal up doesn't
 *     re-show it) AND refreshed when the trial-expiry modal is dismissed in
 *     an "ended" state (stampFreeUpgradeShown below) — so right after the
 *     downgrade modal the user gets 24h of silence, never two takeovers
 *     back to back.
 *   - never opens while a game is playing (hides if one starts), while the
 *     TrialModal is open, or while a freetrial_ended_at stamp is pending
 *     (the trial-ended modal owns that moment).
 *
 * CTA adapts: trial still claimable → blue trial CTA that hands off to the
 * TrialModal; otherwise gold "Upgrade to Premium" straight to checkout
 * (same tab — takeover context).
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useGameStore } from '../stores/gameStore';
import { useTrialModalStore } from '../stores/trialModalStore';
import { canOfferTrial } from '../lib/premium';
import { openBillingPage } from '../lib/openBilling';
import { sendWs } from '../lib/websocket';
import { FEATURES } from './TrialModal';
import { useTranslation } from '../lib/i18n';
import './trial-modal.css';

const DAY_MS = 24 * 60 * 60 * 1000;

const lastShownKey = (userId: string) => `chessr-free-upgrade-last-shown:${userId}`;

/** Reset the 24h clock — also called by TrialExpiryModal when its "trial
 *  ended" state is dismissed, so this modal stays quiet for a day after
 *  the downgrade news. */
export function stampFreeUpgradeShown(userId: string): void {
  browser.storage.local.set({ [lastShownKey(userId)]: Date.now() }).catch(() => {});
}

export default function FreeUpgradeModal() {
  const { t } = useTranslation();
  const { user, plan, planLoading, freetrialUsed, freetrialEndedAt } = useAuthStore();
  const isPlaying = useGameStore((s) => s.isPlaying);
  const trialModalOpen = useTrialModalStore((s) => s.isOpen);
  const openTrialModal = useTrialModalStore((s) => s.open);
  const [open, setOpen] = useState(false);

  const trialOffer = canOfferTrial(plan, freetrialUsed, planLoading);

  useEffect(() => {
    if (open) return;
    if (!user || planLoading || plan !== 'free' || isPlaying) return;
    // The trial-ended modal owns the post-downgrade moment; a TrialModal
    // already on screen means no second takeover.
    if (freetrialEndedAt || trialModalOpen) return;
    let cancelled = false;
    const check = async () => {
      const key = lastShownKey(user.id);
      const stored = await browser.storage.local.get(key).catch(() => ({} as Record<string, unknown>));
      const last = typeof stored[key] === 'number' ? (stored[key] as number) : 0;
      if (cancelled || Date.now() - last < DAY_MS) return;
      stampFreeUpgradeShown(user.id); // stamp at open — reloads don't re-show
      setOpen(true);
      sendWs({ type: 'free_upgrade_modal_shown' });
    };
    check();
    const iv = setInterval(check, 10 * 60_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [open, user?.id, plan, planLoading, isPlaying, freetrialEndedAt, trialModalOpen]);

  // Hide if a game starts — already stamped, so it won't chase the user.
  useEffect(() => {
    if (isPlaying && open) setOpen(false);
  }, [isPlaying, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  const close = () => setOpen(false);

  const handleCta = () => {
    sendWs({ type: 'free_upgrade_modal_cta', mode: trialOffer ? 'trial' : 'upgrade' });
    close();
    if (trialOffer) {
      openTrialModal('free-upgrade-modal');
    } else {
      openBillingPage({ sameTab: true });
    }
  };

  return (
    <div className="trial-modal-backdrop" onClick={close}>
      <div className="trial-modal" onClick={(e) => e.stopPropagation()}>
        <button className="trial-modal-close" onClick={close} aria-label="Close">✕</button>

        <div className="trial-modal-brand">
          <img src={browser.runtime.getURL('/icons/icon128.png')} alt="Chessr" width={32} height={32} />
          <span className="trial-modal-brand-name">chessr<span className="trial-modal-brand-dot">.io</span></span>
        </div>

        <h3 className="trial-modal-title">{t('upgrade.modal.title')}</h3>
        <p className="trial-modal-subtitle">{t('upgrade.modal.subtitle')}</p>

        <ul className="trial-modal-features">
          {FEATURES.map((f) => (
            <li key={f.key}>
              <span className="trial-modal-feature-icon">{f.icon}</span>
              <span>{t(f.key)}</span>
            </li>
          ))}
        </ul>

        {trialOffer ? (
          <button className="trial-modal-cta trial-modal-cta--blue" onClick={handleCta}>
            🎁 {t('trial.cta.full')}
          </button>
        ) : (
          <button className="trial-modal-cta trial-modal-cta--gold" onClick={handleCta}>
            {t('game.review.upgrade')}
          </button>
        )}

        <button className="trial-modal-alt" onClick={close}>
          {t('upgrade.modal.later')}
        </button>
      </div>
    </div>
  );
}
