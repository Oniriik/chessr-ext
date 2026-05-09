import { useState, useEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { useAuthStore } from './stores/authStore';
import { useVersionStore } from './stores/versionStore';
import { useDiscordStore } from './stores/discordStore';
import { useWidgetStore } from './stores/widgetStore';
import { useLayoutStore } from './stores/layoutStore';
import { pickNextHowTo } from './lib/howtos';
import { useLinkedAccountsStore } from './stores/linkedAccountsStore';
import { detectCurrentUsername } from './lib/usernameDetect';
import { fetchPlatformProfile } from './lib/platformApi';
import { useSettingsStore } from './stores/settingsStore';
import AuthForm from './components/AuthForm';
import PanelHeader from './components/PanelHeader';
import UpdateRequired from './components/UpdateRequired';
import Skeleton from './components/Skeleton';
import GameScreen, { type GameTab } from './components/GameScreen';
import SettingsScreen, { type SettingsTab } from './components/SettingsScreen';
import LinkAccountScreen from './components/LinkAccountScreen';
import { useGameStore } from './stores/gameStore';
import FloatingWidget from './components/FloatingWidget';
import { SystemMessageWidget } from './components/SystemMessageWidget';
import HotkeyMoveButtons from './components/HotkeyMoveButtons';
import ReviewScreen from './components/ReviewScreen';
import { useStreamOpen } from './lib/streamOpen';
// BetaGate removed — free users now have access to the extension with
// per-feature premium gating (engine selection, ELO max, personalities,
// etc.). See lib/premium and the individual gates in GameScreen.
import './components/beta-gate.css';
import './app.css';

function getReviewGameId(): string | null {
  try {
    // ReviewScreen is chess.com only (UI strings + api.chess.com fetch).
    // Hard-gate by hostname so worldchess `/game/<uuid>` URLs don't fall
    // through into the regex below — `\d+` would greedy-match the UUID's
    // leading digits and surface a bogus chess.com gameId.
    if (!/(^|\.)chess\.com$/.test(window.location.hostname)) return null;
    const path = window.location.pathname;
    // Don't show review screen for bot games
    if (path.includes('/computer')) return null;
    const match = path.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

interface AppProps {
  /** When true, the App is rendered inside the dedicated Stream Mode tab:
   *  panel always-open, FAB hidden, chessr-panel sized for the page
   *  rather than the corner overlay. The on-platform stream-hide CSS
   *  also doesn't apply (the stream page IS the consumer). */
  streamMode?: boolean;
}

export default function App({ streamMode = false }: AppProps = {}) {
  // Auto-open panel on review/analysis pages (gated by user setting). In
  // stream mode the panel is always open — no toggle, no auto-open logic.
  const [open, setOpen] = useState(() => {
    if (streamMode) return true;
    const path = window.location.pathname;
    const onReviewPage = /\/(?:analysis\/game|game)\/(?:live|daily)\/\d+/.test(path) && !path.includes('/computer');
    if (!onReviewPage) return false;
    return useSettingsStore.getState().autoOpenOnReview;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account');
  const [gameTab, setGameTab] = useState<GameTab>('game');
  const panelRef = useRef<HTMLDivElement>(null);
  const { user, initializing, initialize, plan, planLoading, freetrialUsed } = useAuthStore();
  const waitingForPlan = !!user && planLoading;
  const { isPlaying, gameOver } = useGameStore();
  const autoOpenOnGameEnd = useSettingsStore((s) => s.autoOpenOnGameEnd);
  const fontSize = useSettingsStore((s) => s.fontSize);

  // Auto-open when a game ends (gated by setting).
  const prevGameOver = useRef(gameOver);
  useEffect(() => {
    if (autoOpenOnGameEnd && gameOver && !prevGameOver.current) {
      setOpen(true);
    }
    prevGameOver.current = gameOver;
  }, [gameOver, autoOpenOnGameEnd]);
  const { updateRequired, checking, checkVersion } = useVersionStore();
  const { fetchStatus: fetchDiscord, fetchMembership, linked: discordLinked, inGuild } = useDiscordStore();
  const pushWidget = useWidgetStore((s) => s.push);
  const { fetchAccounts, needsLinking, pendingProfile, setNeedsLinking, accounts, loading: accountsLoading } = useLinkedAccountsStore();
  const disableAnimations = useSettingsStore((s) => s.disableAnimations);

  useEffect(() => {
    checkVersion().then(() => {
      if (!useVersionStore.getState().updateRequired) {
        initialize();
      }
    });
  }, []);

  // Refetch Discord + linked-accounts whenever the auth user changes
  // (initial session restore, fresh sign-in, account switch). Without
  // this, sign-in AFTER the init useEffect leaves discordStore stuck
  // with loading=true and the Discord card shows "..." forever.
  useEffect(() => {
    if (!user) return;
    fetchDiscord(user.id);
    fetchMembership(user.id);
    fetchAccounts(user.id);
  }, [user?.id, fetchDiscord, fetchMembership, fetchAccounts]);

  // System-message widget login triggers. Fires once the auth and the
  // Discord state have both settled — `planLoading` covers
  // freetrialUsed too (same fetch). We deliberately don't push from
  // inside the fetch effects above so the queue stays predictable:
  //   1. free + never-claimed   → "link Discord, claim a 3-day trial"
  //   2. trial-used + linked + not-in-guild → "join the community"
  //   3. otherwise              → next undismissed how-to (if any)
  // Only one nudge per login; the others wait for next session.
  // CTA dispatcher: SystemMessageWidget posts custom events; we route
  // them here. Keeping the widget itself unaware of which screens / tabs
  // the panel exposes lets us reorganise the UI without touching it.
  useEffect(() => {
    const onOpenTab = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab ?? '';
      const [screen, sub] = tab.split(':');
      if (!screen) return;
      setOpen(true);
      if (screen === 'settings') {
        setShowSettings(true);
        if (sub) setSettingsTab(sub as SettingsTab);
      } else if (screen === 'game') {
        setShowSettings(false);
        if (sub) setGameTab(sub as GameTab);
      }
    };
    const onToggleEdit = () => {
      setOpen(true);
      const ls = useLayoutStore.getState();
      ls.setEditMode(!ls.editMode);
    };
    window.addEventListener('chessr:open-tab', onOpenTab);
    window.addEventListener('chessr:toggle-edit-layout', onToggleEdit);
    return () => {
      window.removeEventListener('chessr:open-tab', onOpenTab);
      window.removeEventListener('chessr:toggle-edit-layout', onToggleEdit);
    };
  }, []);

  // Gate login triggers to ONE fire per tab session (sessionStorage)
  // so chess.com's full-page navigations within the same tab don't keep
  // popping the same nudge. New-tab / cleared-storage = fresh fire.
  // WS-broadcast messages bypass this entirely (separate path in
  // content.tsx → useWidgetStore.push).
  //
  // Trial CTA is intentionally first in the cascade — eligible-for-trial
  // beats every other login nudge so users never miss the offer.
  const triggersFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user || planLoading) return;
    if (triggersFiredRef.current === user.id) return;

    const sessionKey = `chessr:login-trigger-fired:${user.id}`;
    try {
      if (sessionStorage.getItem(sessionKey) === '1') {
        triggersFiredRef.current = user.id;
        return;
      }
    } catch { /* sessionStorage blocked → proceed best-effort */ }

    const markFired = () => {
      triggersFiredRef.current = user.id;
      try { sessionStorage.setItem(sessionKey, '1'); } catch {}
    };

    if (plan === 'free' && !freetrialUsed) {
      markFired();
      pushWidget({
        id: 'login-claim-trial',
        category: 'trial',
        title: 'Try chessr Premium for 3 days',
        body: 'Link your Discord account and we\'ll unlock the full premium experience for 3 days (no card needed).',
        cta: { label: 'Link Discord & claim', action: { kind: 'discord-link' } },
      });
      return;
    }

    if (freetrialUsed && discordLinked && inGuild === false) {
      markFired();
      pushWidget({
        id: 'login-join-discord',
        category: 'discord',
        title: 'Join the chessr community',
        body: 'Hop into the Discord — banter, support, and tournaments. We saved you a seat.',
        cta: { label: 'Join the server', action: { kind: 'discord-join', url: 'https://discord.gg/72j4dUadTu' } },
      });
      return;
    }

    const tip = pickNextHowTo();
    if (tip) {
      markFired();
      pushWidget(tip);
    }
  }, [user?.id, plan, freetrialUsed, planLoading, discordLinked, inGuild, pushWidget]);

  // Check if current platform account needs linking after accounts are loaded
  useEffect(() => {
    if (accountsLoading || !user) return;

    const detected = detectCurrentUsername();
    if (!detected) return;

    const alreadyLinked = accounts.some(
      (a) => a.platform === detected.platform && a.username.toLowerCase() === detected.username.toLowerCase(),
    );

    if (!alreadyLinked) {
      fetchPlatformProfile(detected.platform, detected.username).then((profile) => {
        if (!profile) return;
        // Backwards-compat: worldchess rows that pre-date the switch from
        // editable full_name → stable profile id (PR moving to numeric
        // username) match by displayName. If we find such a legacy row,
        // accept the link as already-done instead of re-prompting.
        if (profile.displayName) {
          const legacyMatch = accounts.some(
            (a) => a.platform === profile.platform
                && a.username.toLowerCase() === profile.displayName!.toLowerCase(),
          );
          if (legacyMatch) return;
        }
        setNeedsLinking(true, profile);
      });
    }
  }, [accountsLoading, accounts, user]);

  const prevOpen = useRef(open);
  useEffect(() => {
    const justOpened = open && !prevOpen.current;
    prevOpen.current = open;
    if (!justOpened || !panelRef.current) return;

    if (disableAnimations) {
      gsap.set(panelRef.current, { opacity: 1, y: 0, scale: 1 });
    } else {
      gsap.fromTo(panelRef.current,
        { opacity: 0, y: 16, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'back.out(1.4)' },
      );
    }
  }, [open, disableAnimations]);

  const handleClose = useCallback(() => {
    if (!panelRef.current || disableAnimations) {
      setOpen(false);
      return;
    }
    gsap.to(panelRef.current, {
      opacity: 0, y: 10, scale: 0.97,
      duration: 0.15, ease: 'power2.in',
      onComplete: () => setOpen(false),
    });
  }, [disableAnimations]);

  const loading = checking || (!updateRequired && initializing);
  // When the streamer has Stream Mode open in another tab, hide the
  // on-page panel + trigger so everything is shown only in the dedicated
  // stream tab. CSS hide (not unmount) keeps stores live + lets the
  // panel snap back the moment Stream Mode closes — internal UI state
  // (current tab, scroll, edit mode) is preserved across the toggle.
  const streamOpen = useStreamOpen();
  // Stream-mode override: hide the on-platform UI is N/A inside the
  // stream page itself (this App IS the stream page), and content scripts
  // use the streamOpen flag — which the stream page set on mount.
  const hostHideClass = !streamMode && streamOpen ? 'chessr-host--stream-active' : '';

  return (
    <div className={`chessr-host ${streamMode ? 'chessr-host--stream-mode' : ''} ${hostHideClass}`}>
      {!streamMode && (
        <div
          className="chessr-fab-wrapper"
          data-tooltip={
            updateRequired ? 'Update required'
            : !initializing && !user ? 'Sign in required'
            : needsLinking ? 'Link your account'
            : undefined
          }
        >
          {(updateRequired || (!initializing && !user)) && <span className="chessr-fab-badge" />}
          {!updateRequired && !!user && needsLinking && <span className="chessr-fab-badge chessr-fab-badge--notice" />}
          <button
            className={`chessr-fab ${open ? 'chessr-fab--active' : 'chessr-fab--disabled'}`}
            onClick={() => open ? handleClose() : setOpen(true)}
            aria-label="Toggle Chessr"
          >
            <img src={browser.runtime.getURL('/icons/icon128.png')} alt="Chessr" width={54} height={54} style={{ marginTop: 4 }} />
          </button>
        </div>
      )}

      {open && (
        <div
          className={`chessr-panel ${streamMode ? 'chessr-panel--stream' : ''}`}
          ref={panelRef}
          // 'zoom' scales the whole panel proportionally (text, padding,
          // borders) without touching the 100+ hard-coded font-size rules.
          // Only the panel itself is affected — the fake-title badge and
          // any DOM injected by pageContext into chess.com stay untouched.
          style={fontSize === 'small' ? { zoom: 0.92 } : fontSize === 'big' ? { zoom: 1.1 } : undefined}
        >
          {loading ? (
            <Skeleton />
          ) : updateRequired ? (
            <div className="chessr-panel-body">
              <UpdateRequired />
            </div>
          ) : user ? (
            waitingForPlan ? (
              <div className="chessr-panel-body"><Skeleton /></div>
            ) : needsLinking && pendingProfile ? (
              <>
                <PanelHeader showSettings={false} onToggleSettings={() => {}} hideActions />
                <div className="chessr-panel-body">
                  <LinkAccountScreen profile={pendingProfile} />
                </div>
              </>
            ) : (
              <>
                <PanelHeader showSettings={showSettings} onToggleSettings={() => setShowSettings(!showSettings)} />
                <div className="chessr-panel-body">
                  {(() => {
                    const reviewId = getReviewGameId();
                    if (showSettings) return <SettingsScreen activeTab={settingsTab} setActiveTab={setSettingsTab} />;
                    // ReviewScreen only when not actively playing — during a
                    // live game the URL still matches /game/live/<id>, so we
                    // must gate on isPlaying to keep the GameScreen mounted
                    // mid-match.
                    if (reviewId && !isPlaying) return <ReviewScreen gameId={reviewId} />;
                    return <GameScreen activeTab={gameTab} setActiveTab={setGameTab} />;
                  })()}
                </div>
              </>
            )
          ) : (
            <div className="chessr-panel-body">
              <AuthForm />
            </div>
          )}
        </div>
      )}

      <FloatingWidget />
      <HotkeyMoveButtons />
      {/* The system-message widget hides on the host page (chess.com /
          lichess / worldchess) whenever the dedicated Stream Mode tab
          is open — the streamer's audience shouldn't see private
          notifications, and the stream tab itself renders its own
          instance of this widget reading the same widgetStore mirror
          (see widgetSync.ts). The stream page passes streamMode=true,
          so we keep rendering it there. */}
      {(streamMode || !streamOpen) && <SystemMessageWidget />}
    </div>
  );
}
