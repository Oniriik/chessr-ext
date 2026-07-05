/**
 * TrialModal — centered overlay sold from premium walls when the user can
 * still claim the 3-day free trial (see canOfferTrial). Two paths:
 *
 *   - Discord NOT linked (the common case): the CTA kicks off the existing
 *     Discord OAuth flow via discordStore.initLink → full-page redirect,
 *     returns to this page with ?discord_linked=true&trial=… which App.tsx
 *     already surfaces as a widget. The server auto-claims the trial on
 *     first link (serveur/src/routes/discord.ts).
 *
 *   - Discord already linked but trial never claimed: POST /freetrial/claim
 *     directly and render the result in place — success flips the plan live
 *     (fetchPlan), deny shows the reason.
 *
 * Deny reason `discord_already_used` also flags the account server-side
 * (freetrial_used=true), so a plan refetch makes every trial CTA disappear.
 */

import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useDiscordStore } from '../stores/discordStore';
import { useTrialModalStore } from '../stores/trialModalStore';
import { canOfferTrial } from '../lib/premium';
import { openBillingPage } from '../lib/openBilling';
import { sendWs } from '../lib/websocket';
import { SERVER_URL } from '../lib/config';
import DiscordIcon from './icons/DiscordIcon';
import { useTranslation } from '../lib/i18n';
import './trial-modal.css';

export const FEATURES: { icon: string; key: string }[] = [
  { icon: '🧠', key: 'trial.modal.feature.engines' },
  { icon: '🎛️', key: 'trial.modal.feature.tuning' },
  { icon: '📖', key: 'trial.modal.feature.openings' },
  { icon: '⚡', key: 'trial.modal.feature.automove' },
  { icon: '📊', key: 'trial.modal.feature.reviews' },
];

const CLAIM_ERROR_KEYS: Record<string, string> = {
  discord_already_used: 'trial.modal.error.discordUsed',
  device_already_used: 'trial.modal.error.footprintUsed',
  ip_already_used: 'trial.modal.error.footprintUsed',
  already_used: 'trial.modal.error.alreadyUsed',
  paid_plan: 'trial.modal.error.paidPlan',
};

export default function TrialModal() {
  const { t } = useTranslation();
  const { isOpen, source, close } = useTrialModalStore();
  const { user, plan, freetrialUsed, planLoading, fetchPlan } = useAuthStore();
  const discord = useDiscordStore();
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState(false);

  // Funnel tracking — which wall opened the modal.
  useEffect(() => {
    if (isOpen) sendWs({ type: 'trial_modal_shown', source });
  }, [isOpen, source]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, close]);

  if (!isOpen || !user) return null;
  // The offer may have expired under us (plan refetch flipped
  // freetrialUsed) — never show a claimable modal that would 409. The
  // claimed-success state stays visible: plan just changed to freetrial.
  if (!claimed && !canOfferTrial(plan, freetrialUsed, planLoading)) return null;

  const linked = discord.linked;

  const handleCta = async () => {
    sendWs({ type: 'trial_modal_cta', source, mode: linked ? 'claim' : 'link' });
    if (!linked) {
      // Full-page redirect to the Discord OAuth (existing flow). The
      // server auto-claims the trial and redirects back here.
      discord.initLink(user.id);
      return;
    }
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch(`${SERVER_URL}/freetrial/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setClaimed(true);
        await fetchPlan(user.id); // unlock the UI live
      } else {
        const reason = typeof data?.reason === 'string' ? data.reason : 'unknown';
        setClaimError(t(CLAIM_ERROR_KEYS[reason] ?? 'trial.modal.error.generic'));
        // The server flagged the account — refetch so every trial CTA
        // disappears (this modal included, via the canOfferTrial gate).
        if (reason === 'discord_already_used' || reason === 'device_already_used' || reason === 'already_used') {
          fetchPlan(user.id);
        }
      }
    } catch {
      setClaimError(t('trial.modal.error.generic'));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="trial-modal-backdrop" onClick={close}>
      <div className="trial-modal" onClick={(e) => e.stopPropagation()}>
        <button className="trial-modal-close" onClick={close} aria-label="Close">✕</button>

        {claimed ? (
          <>
            <div className="trial-modal-emoji">🎉</div>
            <h3 className="trial-modal-title">{t('trial.modal.successTitle')}</h3>
            <p className="trial-modal-subtitle">{t('trial.modal.successBody')}</p>
            <button className="trial-modal-cta" onClick={close}>
              {t('trial.modal.successCta')}
            </button>
          </>
        ) : (
          <>
            <div className="trial-modal-emoji">🎁</div>
            <h3 className="trial-modal-title">{t('trial.modal.title')}</h3>
            <p className="trial-modal-subtitle">{t('trial.modal.subtitle')}</p>

            <ul className="trial-modal-features">
              {FEATURES.map((f) => (
                <li key={f.key}>
                  <span className="trial-modal-feature-icon">{f.icon}</span>
                  <span>{t(f.key)}</span>
                </li>
              ))}
            </ul>

            {claimError && <div className="trial-modal-error">{claimError}</div>}

            <button className="trial-modal-cta" onClick={handleCta} disabled={claiming}>
              <DiscordIcon size={18} />
              {claiming
                ? t('trial.modal.claiming')
                : linked
                  ? t('trial.modal.ctaClaim')
                  : t('trial.modal.ctaLink')}
            </button>

            <button
              className="trial-modal-alt"
              onClick={() => { close(); openBillingPage(); }}
            >
              {t('trial.modal.orUpgrade')}
            </button>

            <div className="trial-modal-note">{t('trial.modal.note')}</div>
          </>
        )}
      </div>
    </div>
  );
}
