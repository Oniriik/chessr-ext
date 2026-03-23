/**
 * UpgradeModal - Fullscreen plan selection rendered on document.body via portal
 * Uses inline styles to work outside the Chessr sidebar container
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { openCheckout, type CheckoutPlan } from '../lib/checkoutClient';
import { useAuthStore } from '../stores/authStore';
import type { Plan } from './ui/plan-badge';

// ─── Store ───────────────────────────────────────────────────────────────────

interface UpgradeModalStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useUpgradeModal = create<UpgradeModalStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));

// ─── Data ────────────────────────────────────────────────────────────────────

type BillingCycle = 'monthly' | 'yearly';

const freeFeatures = [
  'Move suggestions + arrows',
  'ELO 300–2000',
  '2 Personalities',
  'Live game analysis',
  'Live Evaluation bar',
  '8 Openings',
  'Chess.com & Lichess',
];

const premiumFeatures = [
  'Full ELO range (300–3500)',
  'All 8 Personalities',
  'Per-phase game analysis',
  'Armageddon mode',
  '+12k Openings with deviation detection',
  'Puzzle support',
  'Move explanations (AI)',
  'Priority support',
];

const lifetimeExtras = [
  'One-time payment',
  'Lifetime access',
  'All future updates',
];

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CrownIcon = ({ size = 14, color = '#22d3ee' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" />
    <path d="M5 21h14" />
  </svg>
);

const ZapIcon = ({ size = 10, color = '#22d3ee' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  </svg>
);


const SparklesIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
);

const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);

const Spinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'chessr-spin 1s linear infinite' }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    <style>{`@keyframes chessr-spin { to { transform: rotate(360deg) } }`}</style>
  </svg>
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCurrentPlan(plan: 'free' | 'premium' | 'lifetime', userPlan: Plan): boolean {
  if (plan === 'free') return userPlan === 'free';
  if (plan === 'premium') return userPlan === 'premium' || userPlan === 'freetrial';
  if (plan === 'lifetime') return userPlan === 'lifetime';
  return false;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UpgradeModal() {
  const { isOpen, close } = useUpgradeModal();
  const session = useAuthStore((s) => s.session);
  const userPlan = useAuthStore((s) => s.plan);
  const [billing, setBilling] = useState<BillingCycle>('yearly');
  const [loading, setLoading] = useState<CheckoutPlan | null>(null);

  if (!isOpen) return null;

  const handleSelect = async (plan: CheckoutPlan) => {
    const token = session?.access_token;
    if (!token) return;
    setLoading(plan);
    try {
      await openCheckout(plan, token);
      close();
    } catch (err) {
      console.error('[Upgrade] Checkout error:', err);
    } finally {
      setLoading(null);
    }
  };

  const premium = billing === 'yearly'
    ? { price: '24.99', original: '29.99', period: '/year' }
    : { price: '2.99', original: null, period: '/month' };

  const isFree = isCurrentPlan('free', userPlan);
  const isPremium = isCurrentPlan('premium', userPlan);
  const isLifetime = isCurrentPlan('lifetime', userPlan);

  const modal = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(5, 5, 15, 0.92)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      {/* Close */}
      <button
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          padding: 8,
          borderRadius: '50%',
          border: 'none',
          background: '#1a1a2e',
          color: 'rgba(255,255,255,0.5)',
          cursor: 'pointer',
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={close}
      >
        <XIcon />
      </button>

      <div style={{ width: '100%', maxWidth: 900, maxHeight: '92vh', overflowY: 'auto', padding: '24px 16px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
            borderRadius: 9999, border: '1px solid #2a3a5c', background: '#111827', marginBottom: 16,
            fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.8)',
          }}>
            <CrownIcon size={12} />
            <span>Simple Pricing</span>
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
            Choose your <span style={{ background: 'linear-gradient(135deg, #3b82f6, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>plan</span>
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
            Start free, upgrade when ready. No hidden fees.
          </p>
        </div>

        {/* Early Access Banner */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '10px 16px', borderRadius: 12, border: '1px solid #164e63', background: '#0c1f2e',
          marginBottom: 20, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto',
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🎁</span>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
            <strong style={{ color: '#22d3ee' }}>Early Access:</strong> Get 15% off for life. Lock in your discount now.
          </p>
        </div>

        {/* Toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', padding: 4,
            borderRadius: 9999, border: '1px solid #2a2a3e', background: '#12121e',
          }}>
            <button
              onClick={() => setBilling('monthly')}
              style={{
                padding: '6px 16px', borderRadius: 9999, border: 'none', fontSize: 12,
                fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                ...(billing === 'monthly'
                  ? { background: 'linear-gradient(135deg, #3b82f6, #22d3ee)', color: '#fff' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.4)' }),
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('yearly')}
              style={{
                padding: '6px 16px', borderRadius: 9999, border: 'none', fontSize: 12,
                fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                ...(billing === 'yearly'
                  ? { background: 'linear-gradient(135deg, #3b82f6, #22d3ee)', color: '#fff' }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.4)' }),
              }}
            >
              Yearly
              {billing === 'yearly' && (
                <span style={{ padding: '2px 6px', borderRadius: 9999, fontSize: 9, fontWeight: 700, background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
                  SAVE 30%
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Responsive grid styles */}
        <style>{`
          .chessr-upgrade-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px; }
          @media (max-width: 700px) { .chessr-upgrade-grid { grid-template-columns: 1fr !important; } }
        `}</style>

        {/* Cards Grid — 3 columns, 1 on mobile */}
        <div className="chessr-upgrade-grid">

          {/* ── Free Plan ── */}
          <div style={{
            position: 'relative', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
            border: isFree ? '1px solid #3b82f6' : '1px solid #1e1e2e', background: '#111119',
          }}>
            {isFree && (
              <div style={{
                position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 10px', borderRadius: '0 0 8px 8px', background: '#3b82f6',
                color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                Current Plan
              </div>
            )}

            <div style={{ marginBottom: 16, paddingTop: isFree ? 12 : 0 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Free</h3>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>€0</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>/forever</span>
              </div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>Start learning for free</p>
            </div>

            <div style={{ marginBottom: 16, flex: 1 }}>
              {freeFeatures.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%', background: '#1e293b',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
                  }}>
                    <span style={{ color: '#3b82f6' }}><CheckIcon /></span>
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: '1.3' }}>{f}</span>
                </div>
              ))}
            </div>

            <button
              disabled
              style={{
                width: '100%', padding: '10px 0', borderRadius: 9999,
                border: '1px solid #1e1e2e', fontWeight: 600, fontSize: 13,
                color: isFree ? 'rgba(255,255,255,0.5)' : '#fff', background: '#111119',
                cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {isFree ? 'Current Plan' : 'Free'}
            </button>
          </div>

          {/* ── Premium Plan ── */}
          <div style={{
            position: 'relative', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
            border: isPremium ? '1px solid #3b82f6' : '1px solid #1e3a5f',
            background: isPremium ? '#0f1a2e' : '#0d1526',
          }}>
            {isPremium ? (
              <div style={{
                position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 10px', borderRadius: '0 0 8px 8px', background: '#3b82f6',
                color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                Current Plan
              </div>
            ) : (
              <div style={{
                position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 10px', borderRadius: '0 0 8px 8px',
                background: 'linear-gradient(135deg, #3b82f6, #22d3ee)',
                color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <CrownIcon size={10} color="#fff" />
                Most Popular
              </div>
            )}

            <div style={{ marginBottom: 16, paddingTop: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Premium</h3>
              {premium.original && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, textDecoration: 'line-through', color: 'rgba(255,255,255,0.3)' }}>€{premium.original}</span>
                  <span style={{ padding: '2px 6px', borderRadius: 9999, fontSize: 9, fontWeight: 700, background: '#0e3a4a', color: '#22d3ee' }}>-15%</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>€{premium.price}</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{premium.period}</span>
              </div>
              <p style={{ fontSize: 10, color: '#22d3ee', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                <SparklesIcon size={10} />
                3-day free trial • No card required
              </p>
            </div>

            <div style={{ marginBottom: 16, flex: 1 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>Everything in Free, plus:</p>
              {premiumFeatures.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%', background: '#0e3a4a',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
                  }}>
                    <span style={{ color: '#22d3ee' }}><CheckIcon /></span>
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: '1.3' }}>{f}</span>
                </div>
              ))}
            </div>

            {isPremium ? (
              <button
                disabled
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9999, border: 'none',
                  fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.5)',
                  background: '#1a2a4a', cursor: 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                Current Plan
              </button>
            ) : (
              <button
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9999, border: 'none',
                  fontWeight: 700, fontSize: 13, color: '#fff',
                  background: 'linear-gradient(135deg, #3b82f6, #22d3ee)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: loading !== null ? 0.5 : 1,
                }}
                onClick={() => handleSelect(billing)}
                disabled={loading !== null}
              >
                {loading === billing ? <Spinner /> : (
                  <>Subscribe {billing === 'yearly' ? 'Yearly' : 'Monthly'} <ArrowRightIcon /></>
                )}
              </button>
            )}
          </div>

          {/* ── Lifetime Plan ── */}
          <div style={{
            position: 'relative', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
            border: isLifetime ? '1px solid #3b82f6' : '1px solid #1e1e2e', background: '#111119',
          }}>
            {isLifetime ? (
              <div style={{
                position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 10px', borderRadius: '0 0 8px 8px', background: '#3b82f6',
                color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                Current Plan
              </div>
            ) : (
              <div style={{
                position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                padding: '4px 10px', borderRadius: '0 0 8px 8px',
                background: 'linear-gradient(135deg, #22d3ee, #3b82f6)',
                color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <ZapIcon size={10} />
                Best Deal
              </div>
            )}

            <div style={{ marginBottom: 16, paddingTop: 12 }}>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>Lifetime</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 14, textDecoration: 'line-through', color: 'rgba(255,255,255,0.3)' }}>€60</span>
                <span style={{ padding: '2px 6px', borderRadius: 9999, fontSize: 9, fontWeight: 700, background: '#0e3a4a', color: '#22d3ee' }}>-15%</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <span style={{ fontSize: 30, fontWeight: 700, color: '#fff' }}>€50</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>/one-time</span>
              </div>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', margin: '4px 0 0' }}>Pay once, own forever</p>
            </div>

            <div style={{ marginBottom: 16, flex: 1 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>Everything in Premium, plus:</p>
              {lifetimeExtras.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: '50%', background: '#1e293b',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
                  }}>
                    <span style={{ color: '#3b82f6' }}><CheckIcon /></span>
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: '1.3' }}>{f}</span>
                </div>
              ))}
            </div>

            {isLifetime ? (
              <button
                disabled
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9999,
                  border: '1px solid #1e1e2e', fontWeight: 600, fontSize: 13,
                  color: 'rgba(255,255,255,0.5)', background: '#111119',
                  cursor: 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                Current Plan
              </button>
            ) : (
              <button
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9999,
                  border: '1px solid #2a2a3e', fontWeight: 600, fontSize: 13,
                  color: '#fff', background: '#16161e',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: loading !== null ? 0.5 : 1,
                }}
                onClick={() => handleSelect('lifetime')}
                disabled={loading !== null}
              >
                {loading === 'lifetime' ? <Spinner /> : (
                  <>Get Lifetime <ArrowRightIcon /></>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <SparklesIcon />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>14-day money-back guarantee</span>
          </div>
          <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ZapIcon size={12} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>Cancel anytime</span>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
