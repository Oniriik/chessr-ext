/**
 * PriceIncreasePlans — the 3-card "upcoming price struck through next to
 * today's price" row + the price-lock fine print, shared by the
 * price-increase variant of FreeUpgradeModal and the announce strip in
 * TrialExpiryModal (grid 2026-07-12). Callers must only render this while
 * `prices.upcoming` is present.
 */

import { useTranslation } from '../lib/i18n';
import { type PricesResponse } from '../lib/priceIncrease';

export default function PriceIncreasePlans({ prices }: { prices: PricesResponse }) {
  const { t } = useTranslation();
  if (!prices.upcoming) return null;

  return (
    <>
      <div className="trial-modal-plans">
        <div className="trial-modal-plan">
          <span className="trial-modal-plan-name">{t('upgrade.increase.monthly')}</span>
          <span className="trial-modal-plan-old">{prices.upcoming.monthly.price}</span>
          <span className="trial-modal-plan-now">{prices.monthly?.price}</span>
          <span className="trial-modal-plan-per">{t('upgrade.increase.perMonth')}</span>
        </div>
        <div className="trial-modal-plan">
          <span className="trial-modal-plan-name">{t('upgrade.increase.yearly')}</span>
          <span className="trial-modal-plan-old">{prices.upcoming.yearly.price}</span>
          <span className="trial-modal-plan-now">{prices.yearly?.price}</span>
          <span className="trial-modal-plan-per">{t('upgrade.increase.perYear')}</span>
        </div>
        <div className="trial-modal-plan trial-modal-plan--best">
          <span className="trial-modal-plan-badge">{t('upgrade.increase.bestDeal')}</span>
          <span className="trial-modal-plan-name">{t('upgrade.increase.lifetime')}</span>
          <span className="trial-modal-plan-old">{prices.upcoming.lifetime.price}</span>
          <span className="trial-modal-plan-now">{prices.lifetime?.price}</span>
          <span className="trial-modal-plan-per">{t('upgrade.increase.oneTime')}</span>
        </div>
      </div>

      <p className="trial-modal-lock-line">
        <strong>{t('upgrade.increase.lock').split('. ')[0]}.</strong>{' '}
        {t('upgrade.increase.lock').split('. ').slice(1).join('. ')}
      </p>
    </>
  );
}
