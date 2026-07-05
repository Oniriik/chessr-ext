import { useAuthStore } from '../stores/authStore';
import { useTrialModalStore } from '../stores/trialModalStore';
import { canOfferTrial } from '../lib/premium';
import { openBillingPage } from '../lib/openBilling';
import { useTranslation } from '../lib/i18n';
import './trial-modal.css';

/**
 * Standard premium-wall CTA block — the same visual pattern everywhere
 * (originally the OpeningTab lock banner):
 *   - trial still claimable → full-width blurple "start your free trial"
 *     button (opens TrialModal, tagged with `source`) + discreet upgrade link
 *   - otherwise → full-width gold "Upgrade" button straight to checkout
 */
/** Full lock-banner card — 🔒 + amber label + the CTA block. Same visual
 *  as the OpeningTab premium banner; use it when the wall needs its own
 *  framed card rather than sitting inside an existing section. */
export function PremiumCtaCard({ source, label, body }: { source: string; label: string; body?: string }) {
  return (
    <div className="premium-cta-card">
      <div className="premium-cta-card-header">
        <span className="premium-cta-card-lock">🔒</span>
        <span>{label}</span>
      </div>
      {body && <div className="premium-cta-card-body">{body}</div>}
      <PremiumCta source={source} />
    </div>
  );
}

export default function PremiumCta({ source }: { source: string }) {
  const { t } = useTranslation();
  const { plan, planLoading, freetrialUsed } = useAuthStore();
  const open = useTrialModalStore((s) => s.open);
  const trialOffer = canOfferTrial(plan, freetrialUsed, planLoading);

  if (trialOffer) {
    return (
      <>
        <button className="premium-cta-btn premium-cta-btn--trial" onClick={() => open(source)}>
          🎁 {t('trial.cta.full')}
        </button>
        <button className="trial-upgrade-alt" onClick={() => openBillingPage()}>
          {t('game.review.upgrade')}
        </button>
      </>
    );
  }
  return (
    <button className="premium-cta-btn premium-cta-btn--gold" onClick={() => openBillingPage()}>
      {t('game.review.upgrade')}
    </button>
  );
}
