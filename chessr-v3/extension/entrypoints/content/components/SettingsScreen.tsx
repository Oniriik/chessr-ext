import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import gsap from 'gsap';
import { useAuthStore, type Plan } from '../stores/authStore';
import { useDiscordStore } from '../stores/discordStore';
import { useLinkedAccountsStore } from '../stores/linkedAccountsStore';
import DiscordIcon from './icons/DiscordIcon';
import LinkIcon from './icons/LinkIcon';
import UnlinkIcon from './icons/UnlinkIcon';
import ChesscomIcon from './icons/ChesscomIcon';
import LichessIcon from './icons/LichessIcon';
import { useSettingsStore } from '../stores/settingsStore';
import { SERVER_URL, WS_SERVER_URL, BUILD_ENV, SERVER_LABEL } from '../lib/config';
import { openBillingPage } from '../lib/openBilling';
import { isPremium, canOfferTrial } from '../lib/premium';
import TabBar from './TabBar';
import Toggle from './Toggle';
import Slider from './Slider';
import { useEngineStore, ENGINE_INFO, type EngineId } from '../stores/engineStore';
import { useGameStore } from '../stores/gameStore';
import { clearPremoveArrow } from '../lib/arrows';
import { useTranslation, SUPPORTED_LOCALES, LOCALE_LABELS, t as tStatic, type LocalePreference } from '../lib/i18n';
import './settings-screen.css';

const serverRegion = SERVER_LABEL[BUILD_ENV];

type Tab = 'account' | 'general' | 'engine' | 'suggestions';

function useTabs(): { id: Tab; label: string }[] {
  const { t } = useTranslation();
  return [
    { id: 'account',     label: t('settings.tab.account') },
    { id: 'general',     label: t('settings.tab.general') },
    { id: 'engine',      label: t('settings.tab.engine') },
    { id: 'suggestions', label: t('settings.tab.suggestions') },
  ];
}

function usePlanDisplay(): Record<Plan, { label: string; bg: string; color: string; cta: string | null }> {
  const { t } = useTranslation();
  return {
    lifetime:  { label: t('settings.account.plan.lifetime'),  bg: '#8263F1', color: '#3F2F7A', cta: null },
    beta:      { label: t('settings.account.plan.beta'),      bg: '#6366f1', color: '#252972', cta: null },
    premium:   { label: t('settings.account.plan.premium'),   bg: '#60a5fa', color: '#264A70', cta: t('settings.account.manageSubscription') },
    freetrial: { label: t('settings.account.plan.freetrial'), bg: '#9c4040', color: '#481A1A', cta: t('settings.account.upgrade') },
    free:      { label: t('settings.account.plan.free'),      bg: '#EAB308', color: '#574407', cta: t('settings.account.upgrade') },
  };
}

function getExpiryText(expiry: Date): string {
  const days = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return tStatic('settings.account.expired');
  if (days === 0) return tStatic('settings.account.expiresToday');
  if (days === 1) return tStatic('settings.account.expiresTomorrow');
  return tStatic('settings.account.expiresInDays', { days });
}

const platformIcons: Record<string, typeof ChesscomIcon> = {
  chesscom: ChesscomIcon,
  lichess: LichessIcon,
  worldchess: LichessIcon,
};

const platformLabels: Record<string, string> = {
  chesscom: 'Chess.com',
  lichess: 'Lichess',
  worldchess: 'WorldChess',
};

const TITLE_OPTIONS: { value: import('../stores/settingsStore').ChessTitle; label: string }[] = [
  { value: 'GM', label: 'GM — Grandmaster' },
  { value: 'IM', label: 'IM — International Master' },
  { value: 'FM', label: 'FM — FIDE Master' },
  { value: 'NM', label: 'NM — National Master' },
  { value: 'CM', label: 'CM — Candidate Master' },
  { value: 'WGM', label: 'WGM — Woman Grandmaster' },
  { value: 'WIM', label: 'WIM — Woman International Master' },
  { value: 'WFM', label: 'WFM — Woman FIDE Master' },
  { value: 'WCM', label: 'WCM — Woman Candidate Master' },
  { value: 'WNM', label: 'WNM — Woman National Master' },
];

function GeneralTab() {
  const { t } = useTranslation();
  const { disableAnimations, setDisableAnimations, disableInfoBanner, setDisableInfoBanner, anonNames, setAnonNames, showTitle, setShowTitle, titleType, setTitleType, autoOpenOnGameEnd, setAutoOpenOnGameEnd, autoOpenOnReview, setAutoOpenOnReview, fontSize, setFontSize, locale, setLocale, resetAll } = useSettingsStore();
  const handleReset = () => {
    if (confirm(t('settings.general.resetConfirm'))) {
      resetAll();
    }
  };

  const [debugLabel, setDebugLabel] = React.useState<'idle' | 'copying' | 'copied' | 'error'>('idle');
  const handleCopyDebug = async () => {
    setDebugLabel('copying');
    try {
      const { collectDebugDump } = await import('../lib/diagBuffer');
      const auth = useAuthStore.getState();
      const engine = useEngineStore.getState();
      const settings = useSettingsStore.getState();
      const game = useGameStore.getState();
      const meta = {
        extensionVersion: browser.runtime.getManifest().version,
        buildEnv: BUILD_ENV,
        wsUrl: WS_SERVER_URL,
        userId: auth.user?.id ? auth.user.id.slice(0, 8) + '…' : '(none)',
        plan: auth.plan ?? '(none)',
        engineId: engine.engineId,
        game: {
          fen: game.fen,
          isPlaying: game.isPlaying,
          gameOver: game.gameOver,
          playerColor: game.playerColor,
          turn: game.turn,
        },
        settings: {
          numArrows: settings.numArrows,
          maiaVariant: engine.maiaVariant,
          targetEloAuto: engine.targetEloAuto,
          searchMode: engine.searchMode,
        },
      };
      const dump = await collectDebugDump(meta);
      await navigator.clipboard.writeText(dump);
      setDebugLabel('copied');
      setTimeout(() => setDebugLabel('idle'), 2000);
    } catch (err) {
      console.error('[Chessr] copy debug logs failed:', err);
      setDebugLabel('error');
      setTimeout(() => setDebugLabel('idle'), 2500);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-item">
        <span className="settings-label">{t('settings.general.language')}</span>
        <select
          className="settings-select"
          value={locale}
          onChange={(e) => setLocale(e.target.value as LocalePreference)}
        >
          <option value="auto">{t('settings.general.language.auto')}</option>
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>{LOCALE_LABELS[code]}</option>
          ))}
        </select>
      </div>
      <div className="settings-item">
        <span className="settings-label">{t('settings.general.anonNames')}</span>
        <Toggle checked={anonNames} onChange={setAnonNames} />
      </div>
      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">{t('settings.general.fakeTitle')}</span>
          <Toggle checked={showTitle} onChange={setShowTitle} />
        </div>
        {showTitle && (
          <div className="settings-item-subrow">
            <span className="settings-desc">{t('settings.general.selectTitle')}</span>
            <select
              className="settings-select"
              value={titleType}
              onChange={(e) => setTitleType(e.target.value as import('../stores/settingsStore').ChessTitle)}
            >
              {TITLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="settings-item">
        <span className="settings-label">{t('settings.general.autoOpenReview')}</span>
        <Toggle checked={autoOpenOnReview} onChange={setAutoOpenOnReview} />
      </div>
      <div className="settings-item">
        <span className="settings-label">{t('settings.general.autoOpenGameEnd')}</span>
        <Toggle checked={autoOpenOnGameEnd} onChange={setAutoOpenOnGameEnd} />
      </div>
      <div className="settings-item">
        <span className="settings-label">{t('settings.general.fontSize')}</span>
        <select
          className="settings-select"
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as import('../stores/settingsStore').FontSize)}
        >
          <option value="small">{t('settings.general.fontSize.small')}</option>
          <option value="normal">{t('settings.general.fontSize.normal')}</option>
          <option value="big">{t('settings.general.fontSize.big')}</option>
        </select>
      </div>
      <div className="settings-item">
        <span className="settings-label">{t('settings.general.disableAnimations')}</span>
        <Toggle checked={disableAnimations} onChange={setDisableAnimations} />
      </div>
      <div className="settings-item" title={t('settings.general.disableInfoBanner.hint')}>
        <span className="settings-label">{t('settings.general.disableInfoBanner')}</span>
        <Toggle checked={disableInfoBanner} onChange={setDisableInfoBanner} />
      </div>
      <button
        className="settings-stream-btn"
        onClick={() => browser.runtime.sendMessage({ type: 'open_stream' })}
        title={t('settings.general.openStream.hint')}
      >
        {t('settings.general.openStream')}
      </button>
      <button className="settings-reset-btn" onClick={handleReset}>
        {t('settings.general.reset')}
      </button>
      <button
        className="settings-debug-btn"
        onClick={handleCopyDebug}
        title={t('settings.general.copyDebug.hint')}
      >
        {debugLabel === 'idle'    && t('settings.general.copyDebug')}
        {debugLabel === 'copying' && t('settings.general.copyDebug.collecting')}
        {debugLabel === 'copied'  && t('settings.general.copyDebug.copied')}
        {debugLabel === 'error'   && t('settings.general.copyDebug.error')}
      </button>
    </div>
  );
}

function SuggestionsTab() {
  const { t } = useTranslation();
  const {
    showSuggestedMoves, numArrows, arrowColors, highlightSquares, showMyLastMove,
    showOpponentArrow, opponentArrowColor, showPremoveArrow, premoveArrowColor,
    setShowSuggestedMoves, setNumArrows, setArrowColor, setHighlightSquares, setShowMyLastMove,
    setShowOpponentArrow, setOpponentArrowColor, setShowPremoveArrow, setPremoveArrowColor,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">{t('settings.suggestions.numArrows')}</span>
          <div className="settings-num-arrows">
            <button
              className={`settings-num-btn ${!showSuggestedMoves ? 'settings-num-btn--active' : ''}`}
              style={{ width: 'auto', padding: '0 10px' }}
              onClick={() => setShowSuggestedMoves(false)}
            >
              {t('settings.suggestions.arrowDisabled')}
            </button>
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                className={`settings-num-btn ${showSuggestedMoves && numArrows === n ? 'settings-num-btn--active' : ''}`}
                onClick={() => { setNumArrows(n); setShowSuggestedMoves(true); }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {showSuggestedMoves && Array.from({ length: numArrows }).map((_, i) => (
          <div key={i} className="settings-item-row">
            <div className="settings-color-label">
              <span className="settings-color-dot" style={{ background: arrowColors[i] }} />
              <span className="settings-label">{t('settings.suggestions.arrow', { n: i + 1 })}</span>
            </div>
            <input
              type="color"
              value={arrowColors[i]}
              onChange={(e) => setArrowColor(i, e.target.value)}
              className="settings-color-input"
            />
          </div>
        ))}
      </div>

      <div className="settings-item">
        <span className="settings-label">{t('settings.suggestions.highlightSquares')}</span>
        <Toggle checked={highlightSquares} onChange={setHighlightSquares} />
      </div>

      <div className="settings-item">
        <span className="settings-label">{t('settings.suggestions.showMyLastMove')}</span>
        <Toggle checked={showMyLastMove} onChange={setShowMyLastMove} />
      </div>

      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">{t('settings.suggestions.opponentArrow')}</span>
          <Toggle checked={showOpponentArrow} onChange={setShowOpponentArrow} />
        </div>

        {showOpponentArrow && (
          <div className="settings-item-row">
            <div className="settings-color-label">
              <span className="settings-color-dot" style={{ background: opponentArrowColor }} />
              <span className="settings-label">{t('settings.suggestions.opponentArrowColor')}</span>
            </div>
            <input
              type="color"
              value={opponentArrowColor}
              onChange={(e) => setOpponentArrowColor(e.target.value)}
              className="settings-color-input"
            />
          </div>
        )}
      </div>

      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">{t('settings.suggestions.premoveArrow')}</span>
          <Toggle
            checked={showPremoveArrow}
            onChange={(v) => { setShowPremoveArrow(v); if (!v) clearPremoveArrow(); }}
          />
        </div>

        {showPremoveArrow && (
          <div className="settings-item-row">
            <div className="settings-color-label">
              <span className="settings-color-dot" style={{ background: premoveArrowColor }} />
              <span className="settings-label">{t('settings.suggestions.premoveArrowColor')}</span>
            </div>
            <input
              type="color"
              value={premoveArrowColor}
              onChange={(e) => setPremoveArrowColor(e.target.value)}
              className="settings-color-input"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export type { Tab as SettingsTab };

export default function SettingsScreen({ activeTab, setActiveTab }: { activeTab: Tab; setActiveTab: (t: Tab) => void }) {
  const { t } = useTranslation();
  const tabs = useTabs();
  const planDisplay = usePlanDisplay();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const { user, plan, planExpiry, planLoading, freetrialUsed } = useAuthStore();
  const trialOffer = canOfferTrial(plan, freetrialUsed, planLoading);
  const discord = useDiscordStore();
  const { accounts, loading: accountsLoading, unlinkAccount } = useLinkedAccountsStore();
  const [latency, setLatency] = useState<number | null>(null);
  const config = planDisplay[plan];
  const showExpiry = planExpiry && (plan === 'premium' || plan === 'freetrial');

  // Ping server every 10s while account tab is visible
  useEffect(() => {
    if (activeTab !== 'account') return;

    const ping = async () => {
      try {
        const t0 = performance.now();
        await fetch(`${SERVER_URL}/health`, { cache: 'no-store' });
        setLatency(Math.round(performance.now() - t0));
      } catch {
        setLatency(null);
      }
    };

    ping();
    const id = setInterval(ping, 10_000);
    return () => clearInterval(id);
  }, [activeTab]);

  // Tab-change fade-in
  const tabContentRef = useRef<HTMLDivElement>(null);
  const firstTabRender = useRef(true);
  useLayoutEffect(() => {
    if (firstTabRender.current) { firstTabRender.current = false; return; }
    if (!tabContentRef.current) return;
    if (useSettingsStore.getState().disableAnimations) return;
    gsap.fromTo(tabContentRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out' });
  }, [activeTab]);

  return (
    <div className="settings-screen">
      <TabBar tabs={tabs} active={activeTab} onChange={setActiveTab} />

      <div ref={tabContentRef} className="settings-tab-content">
      {activeTab === 'account' && (
        <div className="settings-section">
          <div className="settings-item settings-item--column">
            <div className="settings-item-row">
              <span className="settings-label">{t('settings.account.title')}</span>
              {user?.email_confirmed_at ? (
                <span className="settings-verified">{t('settings.account.verified')}</span>
              ) : (
                <span className="settings-unverified">{t('settings.account.unverified')}</span>
              )}
            </div>
            <div className="settings-account-email">{user?.email || '—'}</div>
            {user?.created_at && (
              <div className="settings-account-joined">
                {t('settings.account.joined', { date: new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) })}
              </div>
            )}
          </div>
          <div className="settings-item">
            <span className="settings-label">{t('settings.account.server')}</span>
            <span className="settings-value">
              <span className="settings-value--dim">{serverRegion}</span>
              {' '}
              <span style={{ color: latency === null ? undefined : latency < 200 ? '#22c55e' : latency < 500 ? '#fbbf24' : '#f87171' }}>
                {latency !== null ? `${latency}ms` : '—'}
              </span>
            </span>
          </div>
          <div className="settings-plan-card">
            <div className="settings-plan-row">
              <span className="settings-label">{t('settings.account.plan')}</span>
              <span className="settings-plan-badge" style={{ background: config.bg, color: config.color }}>
                {config.label}
              </span>
            </div>
            {showExpiry && (
              <span className="settings-plan-expiry">{getExpiryText(planExpiry)}</span>
            )}
            {config.cta && (
              <button className="settings-plan-cta" onClick={() => openBillingPage()}>{config.cta}</button>
            )}
          </div>
          <div className="settings-discord-card">
            <div className="settings-discord-row">
              <div className="settings-discord-left">
                <span className="settings-discord-icon"><DiscordIcon /></span>
                <span className="settings-label">{t('settings.account.discord')}</span>
              </div>
              {discord.loading ? (
                <span className="settings-discord-status">...</span>
              ) : discord.linked ? (
                <div className="settings-discord-user">
                  {discord.avatar && <img className="settings-discord-avatar" src={discord.avatar} alt="" />}
                  <span className="settings-discord-username">{discord.username}</span>
                  <button className="settings-discord-unlink-icon" onClick={() => user && discord.unlink(user.id)} title={t('settings.account.discord.unlink')}>
                    <span className="settings-discord-link-state"><LinkIcon /></span>
                    <span className="settings-discord-unlink-state"><UnlinkIcon /></span>
                  </button>
                </div>
              ) : (
                <span className="settings-discord-status">{t('settings.account.discord.notLinked')}</span>
              )}
            </div>
            {!discord.linked && !discord.loading && (
              // Linking auto-claims the 3-day trial server-side, so while
              // it's still claimable the button sells the trial, not the link.
              <button className="settings-discord-link-btn" onClick={() => user && discord.initLink(user.id)}>
                {trialOffer ? <><span style={{ fontSize: 13, lineHeight: 1 }}>🎁</span>{t('trial.modal.ctaLink')}</> : t('settings.account.discord.linkBtn')}
              </button>
            )}
          </div>
          <div className="settings-accounts-card">
            <button className="settings-accounts-toggle" onClick={() => setAccountsOpen(!accountsOpen)}>
              <div className="settings-accounts-toggle-left">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>{t('settings.account.chessAccounts')}</span>
              </div>
              <div className="settings-accounts-toggle-right">
                <span className="settings-accounts-count">{accountsLoading ? '...' : accounts.length}</span>
                <svg className={`settings-accounts-chevron ${accountsOpen ? 'settings-accounts-chevron--open' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </button>
            {accountsOpen && (
              <div className="settings-accounts-list">
                {accounts.length === 0 ? (
                  <p className="settings-accounts-empty">No accounts linked</p>
                ) : (
                  Object.entries(
                    accounts.reduce<Record<string, typeof accounts>>((groups, account) => {
                      (groups[account.platform] ??= []).push(account);
                      return groups;
                    }, {})
                  ).map(([platform, platformAccounts]) => {
                    const Icon = platformIcons[platform];
                    return (
                      <div key={platform} className="settings-accounts-group">
                        <div className="settings-accounts-group-header">
                          <Icon size={16} />
                          <span>{platformLabels[platform] || platform}</span>
                          <span className="settings-accounts-group-count">{platformAccounts.length}</span>
                        </div>
                        {platformAccounts.map((account) => (
                          <div key={account.id} className="settings-accounts-item">
                            <span className="settings-accounts-username">{account.username}</span>
                            <button className="settings-discord-unlink-icon" onClick={() => user && unlinkAccount(account.id, user.id)} title="Unlink">
                              <span className="settings-discord-link-state"><LinkIcon /></span>
                              <span className="settings-discord-unlink-state"><UnlinkIcon /></span>
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'general' && (
        <GeneralTab />
      )}

      {activeTab === 'engine' && (
        <EngineSettingsTab />
      )}

      {activeTab === 'suggestions' && (
        <SuggestionsTab />
      )}
      </div>
    </div>
  );
}

/** Engines available on the free tier. Maia 2 / Maia 3 stay premium —
 *  they're the human-style engines that justify upgrading. Komodo and
 *  Stockfish are the two classical engines; both unlocked on free. */
const FREE_TIER_ENGINES: EngineId[] = ['komodo', 'stockfish'];

function EngineSettingsTab() {
  const { engineId, setEngineId, autoEloBoost, setAutoEloBoost } = useEngineStore();
  const plan = useAuthStore((s) => s.plan);
  const premium = isPremium(plan);
  const engineIds = Object.keys(ENGINE_INFO) as EngineId[];
  // Tolerate a stale engineId (e.g. 'patricia' from pre-3.1.0 cloud state)
  // by falling back to the first known engine. The cloud sanitizer in
  // settingsStore.ts will rewrite the cloud row on next save.
  const info = ENGINE_INFO[engineId] ?? ENGINE_INFO[engineIds[0]];

  return (
    <div className="settings-section">
      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">Used engine</span>
          <select
            className="settings-select"
            value={engineId}
            onChange={(e) => {
              const next = e.target.value as EngineId;
              // Hard guard: if a free user manages to submit a premium
              // engine ID anyway, snap them back to Komodo. Belt and
              // suspenders since the option is also `disabled` below.
              if (!premium && !FREE_TIER_ENGINES.includes(next)) {
                setEngineId('komodo');
                return;
              }
              setEngineId(next);
            }}
          >
            {engineIds.map((id) => {
              const locked = !premium && !FREE_TIER_ENGINES.includes(id);
              return (
                <option key={id} value={id} disabled={locked}>
                  {ENGINE_INFO[id].label}
                  {ENGINE_INFO[id].beta ? ' (beta)' : ''}
                  {locked ? ' — Premium' : ''}
                </option>
              );
            })}
          </select>
        </div>
        <div className="settings-engine-meta">
          {info.beta && (
            <span className="settings-engine-beta-badge">BETA</span>
          )}
          <span className="settings-engine-elo">ELO range: <strong>{info.eloRange}</strong></span>
          <span className="settings-engine-desc">{info.desc}</span>
        </div>
      </div>

      <div className="settings-item settings-item--column">
        <div className="settings-item-row">
          <span className="settings-label">Auto ELO Boost</span>
          <span className="settings-slider-value">+{autoEloBoost}</span>
        </div>
        <Slider min={0} max={500} step={10} value={autoEloBoost} onChange={setAutoEloBoost} trackColor="linear-gradient(90deg, #22c55e, #3b82f6)" thumbColor="#22c55e" thumbColorEnd="#3b82f6" />
        <span className="settings-engine-desc">Added to opponent's ELO when Auto ELO is enabled.</span>
      </div>
    </div>
  );
}
