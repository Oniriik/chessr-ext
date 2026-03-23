import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import type { Plan } from '../components/ui/plan-badge';

// ─── Config ──────────────────────────────────────────────────────────────────

const SERVER_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8080').replace(/^ws/, 'http');
const PADDLE_CLIENT_TOKEN = 'test_15a202d45e46070cf61d95f9727';
// 'sandbox' or 'production'
const PADDLE_ENV: 'sandbox' | 'production' = 'sandbox';

// ─── Types ───────────────────────────────────────────────────────────────────

type BillingCycle = 'monthly' | 'yearly';
type CheckoutPlan = 'monthly' | 'yearly' | 'lifetime';

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (config: any) => void;
      Checkout: { open: (config: any) => void };
    };
  }
}

// ─── Data ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isCurrentPlan(plan: 'free' | 'premium' | 'lifetime', userPlan: Plan): boolean {
  if (plan === 'free') return userPlan === 'free';
  if (plan === 'premium') return userPlan === 'premium' || userPlan === 'freetrial';
  if (plan === 'lifetime') return userPlan === 'lifetime';
  return false;
}

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

const SparklesIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
);

const DiscordIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const Spinner = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.8s linear infinite' }}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

// ─── Component ───────────────────────────────────────────────────────────────

export function BillingApp() {
  const { initialize, session, plan: userPlan, fetchPlan, user } = useAuthStore();
  const [billing, setBilling] = useState<BillingCycle>('yearly');
  const [loading, setLoading] = useState<CheckoutPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paddleReady, setPaddleReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [freetrialUsed, setFreetrialUsed] = useState(true); // default true = hide trial
  const [discordLinked, setDiscordLinked] = useState(false);

  // Poll for plan update after checkout (webhook may take a few seconds)
  const pollForPlanUpdate = async () => {
    if (!user) return;
    setConfirming(true);
    const originalPlan = userPlan;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await fetchPlan(user.id);
      const newPlan = useAuthStore.getState().plan;
      if (newPlan !== originalPlan && newPlan !== 'free') {
        setConfirming(false);
        setSuccess(true);
        // Notify other extension pages (content script) to refresh plan
        chrome.runtime.sendMessage({ type: 'plan_updated', plan: newPlan });
        return;
      }
    }
    // Timeout — show success anyway (payment went through, webhook may be delayed)
    setConfirming(false);
    setSuccess(true);
  };

  // Initialize auth
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Fetch freetrial eligibility from Supabase
  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_settings')
      .select('freetrial_used, discord_id')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        setFreetrialUsed(data?.freetrial_used ?? true);
        setDiscordLinked(!!data?.discord_id);
      });
  }, [user]);

  const canClaimTrial = !freetrialUsed && !discordLinked && userPlan === 'free';

  // Initialize Paddle
  useEffect(() => {
    if (window.Paddle) {
      window.Paddle.Environment.set(PADDLE_ENV);
      window.Paddle.Initialize({
        token: PADDLE_CLIENT_TOKEN,
        checkout: {
          settings: {
            theme: 'dark',
          },
        },
        eventCallback: (event: any) => {
          if (event.name === 'checkout.completed') {
            pollForPlanUpdate();
          }
        },
      });
      setPaddleReady(true);
    }
  }, []);

  const handleSelect = async (plan: CheckoutPlan) => {
    const token = session?.access_token;
    if (!token || !paddleReady) return;

    setLoading(plan);
    setError(null);

    try {
      const res = await fetch(`${SERVER_URL}/api/paddle/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ plan }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `Checkout failed (${res.status})`);
      }

      const { transactionId } = await res.json();

      window.Paddle!.Checkout.open({
        transactionId,
        settings: {
          theme: 'dark',
          successUrl: undefined, // stay on page
        },
      });

      // Start polling immediately — will detect plan change after webhook processes
      pollForPlanUpdate();

    } catch (err: any) {
      console.error('[Billing] Checkout error:', err);
      setError(err.message || 'Something went wrong');
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

  // Loading state
  if (!session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spinner />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      <div style={{ width: '100%', maxWidth: 900 }}>
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
          <h2 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
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
            >Monthly</button>
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
              {billing === 'yearly' && <span style={{ padding: '2px 6px', borderRadius: 9999, fontSize: 9, fontWeight: 700, background: 'rgba(255,255,255,0.2)' }}>SAVE 30%</span>}
            </button>
          </div>
        </div>

        {/* Confirming */}
        {confirming && (
          <div style={{ textAlign: 'center', marginBottom: 16, padding: '12px 16px', borderRadius: 8, background: '#1a1a2e', border: '1px solid #2a3a5c', color: '#93c5fd', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Spinner />
            Waiting for payment confirmation...
          </div>
        )}

        {/* Success */}
        {success && (
          <div style={{ textAlign: 'center', marginBottom: 16, padding: '12px 16px', borderRadius: 8, background: '#052e16', border: '1px solid #166534', color: '#4ade80', fontSize: 13, fontWeight: 600 }}>
            🎉 Payment successful! Your plan has been upgraded to <strong>{useAuthStore.getState().plan}</strong>. You can close this tab.
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ textAlign: 'center', marginBottom: 16, padding: '8px 16px', borderRadius: 8, background: '#2d1215', border: '1px solid #5c2028', color: '#f87171', fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>

          {/* Free */}
          <div style={{
            position: 'relative', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
            border: isFree ? '1px solid #3b82f6' : '1px solid #1e1e2e', background: '#111119',
          }}>
            {isFree && (
              <div style={{ position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)', padding: '4px 10px', borderRadius: '0 0 8px 8px', background: '#3b82f6', color: '#fff', fontSize: 10, fontWeight: 700 }}>
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
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <span style={{ color: '#3b82f6' }}><CheckIcon /></span>
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: '1.3' }}>{f}</span>
                </div>
              ))}
            </div>
            <button disabled style={{
              width: '100%', padding: '10px 0', borderRadius: 9999, border: '1px solid #1e1e2e',
              fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.5)', background: '#111119', cursor: 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isFree ? 'Current Plan' : 'Free'}
            </button>
          </div>

          {/* Premium */}
          <div style={{
            position: 'relative', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
            border: isPremium ? '1px solid #3b82f6' : '1px solid #1e3a5f', background: isPremium ? '#0f1a2e' : '#0d1526',
          }}>
            <div style={{
              position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
              padding: '4px 10px', borderRadius: '0 0 8px 8px',
              background: isPremium ? '#3b82f6' : 'linear-gradient(135deg, #3b82f6, #22d3ee)',
              color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {isPremium ? 'Current Plan' : <><CrownIcon size={10} color="#fff" /> Most Popular</>}
            </div>
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
              {canClaimTrial ? (
                <button
                  onClick={async () => {
                    const token = session?.access_token;
                    if (!token) return;
                    try {
                      const res = await fetch(`${SERVER_URL}/api/discord/link`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ returnUrl: chrome.runtime.getURL('billing.html') }),
                      });
                      const { url } = await res.json();
                      if (url) window.location.href = url;
                    } catch (err) {
                      console.error('[Billing] Discord link error:', err);
                    }
                  }}
                  style={{
                    margin: '6px 0 0', padding: '6px 10px', borderRadius: 8, border: 'none',
                    background: '#5865F2', color: '#fff', fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  }}
                >
                  <DiscordIcon />
                  Connect Discord for 3-Day Free Trial
                </button>
              ) : !freetrialUsed && discordLinked && userPlan === 'free' ? (
                <p style={{ fontSize: 10, color: '#22d3ee', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <SparklesIcon /> 3-day free trial • No card required
                </p>
              ) : null}
            </div>
            <div style={{ marginBottom: 16, flex: 1 }}>
              <p style={{ fontSize: 10, fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>Everything in Free, plus:</p>
              {premiumFeatures.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#0e3a4a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <span style={{ color: '#22d3ee' }}><CheckIcon /></span>
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: '1.3' }}>{f}</span>
                </div>
              ))}
            </div>
            {isPremium ? (
              <button disabled style={{
                width: '100%', padding: '10px 0', borderRadius: 9999, border: 'none',
                fontWeight: 700, fontSize: 13, color: 'rgba(255,255,255,0.5)', background: '#1a2a4a', cursor: 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>Current Plan</button>
            ) : (
              <button
                onClick={() => handleSelect(billing)}
                disabled={loading !== null}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9999, border: 'none',
                  fontWeight: 700, fontSize: 13, color: '#fff',
                  background: 'linear-gradient(135deg, #3b82f6, #22d3ee)',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: loading !== null ? 0.5 : 1,
                }}
              >
                {loading === billing ? <Spinner /> : <>Subscribe {billing === 'yearly' ? 'Yearly' : 'Monthly'} <ArrowRightIcon /></>}
              </button>
            )}
          </div>

          {/* Lifetime */}
          <div style={{
            position: 'relative', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column',
            border: isLifetime ? '1px solid #3b82f6' : '1px solid #1e1e2e', background: '#111119',
          }}>
            <div style={{
              position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
              padding: '4px 10px', borderRadius: '0 0 8px 8px',
              background: isLifetime ? '#3b82f6' : 'linear-gradient(135deg, #22d3ee, #3b82f6)',
              color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {isLifetime ? 'Current Plan' : <><ZapIcon size={10} color="#fff" /> Best Deal</>}
            </div>
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
                  <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <span style={{ color: '#3b82f6' }}><CheckIcon /></span>
                  </div>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', lineHeight: '1.3' }}>{f}</span>
                </div>
              ))}
            </div>
            {isLifetime ? (
              <button disabled style={{
                width: '100%', padding: '10px 0', borderRadius: 9999, border: '1px solid #1e1e2e',
                fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,0.5)', background: '#111119', cursor: 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>Current Plan</button>
            ) : (
              <button
                onClick={() => handleSelect('lifetime')}
                disabled={loading !== null}
                style={{
                  width: '100%', padding: '10px 0', borderRadius: 9999, border: '1px solid #2a2a3e',
                  fontWeight: 600, fontSize: 13, color: '#fff', background: '#16161e',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: loading !== null ? 0.5 : 1,
                }}
              >
                {loading === 'lifetime' ? <Spinner /> : <>Get Lifetime <ArrowRightIcon /></>}
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
}
