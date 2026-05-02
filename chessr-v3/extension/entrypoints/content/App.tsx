import { useState, useEffect, useRef, useCallback } from 'react';
import gsap from 'gsap';
import { useAuthStore } from './stores/authStore';
import { useVersionStore } from './stores/versionStore';
import { useDiscordStore } from './stores/discordStore';
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
  const { user, initializing, initialize, plan: _plan, planLoading } = useAuthStore();
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
  const { fetchStatus: fetchDiscord } = useDiscordStore();
  const { fetchAccounts, needsLinking, pendingProfile, setNeedsLinking, accounts, loading: accountsLoading } = useLinkedAccountsStore();
  const disableAnimations = useSettingsStore((s) => s.disableAnimations);

  useEffect(() => {
    checkVersion().then(() => {
      if (!useVersionStore.getState().updateRequired) {
        initialize().then(() => {
          const u = useAuthStore.getState().user;
          if (u) {
            fetchDiscord(u.id);
            fetchAccounts(u.id);
          }
        });
      }
    });
  }, []);

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
        if (profile) setNeedsLinking(true, profile);
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
    </div>
  );
}
