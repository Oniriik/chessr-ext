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
import BetaGate from './components/BetaGate';
import './components/beta-gate.css';
import './app.css';

const PREMIUM_PLANS = ['premium', 'lifetime', 'beta', 'freetrial'];
function isPremiumPlan(plan: string | undefined): boolean {
  return PREMIUM_PLANS.includes(plan ?? '');
}

function getReviewGameId(): string | null {
  try {
    const path = window.location.pathname;
    // Don't show review screen for bot games
    if (path.includes('/computer')) return null;
    const match = path.match(/\/(?:game|analysis\/game)\/(?:live\/|daily\/)?(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

export default function App() {
  // Auto-open panel on review/analysis pages (gated by user setting)
  const [open, setOpen] = useState(() => {
    const path = window.location.pathname;
    const onReviewPage = /\/(?:analysis\/game|game)\/(?:live|daily)\/\d+/.test(path) && !path.includes('/computer');
    if (!onReviewPage) return false;
    return useSettingsStore.getState().autoOpenOnReview;
  });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('account');
  const [gameTab, setGameTab] = useState<GameTab>('game');
  const panelRef = useRef<HTMLDivElement>(null);
  const { user, initializing, initialize, plan, planLoading } = useAuthStore();
  const premium = isPremiumPlan(plan);
  const waitingForPlan = !!user && planLoading;
  const { isPlaying, gameOver } = useGameStore();
  const autoOpenOnGameEnd = useSettingsStore((s) => s.autoOpenOnGameEnd);

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

  return (
    <>
      <div
        className="chessr-fab-wrapper"
        data-tooltip={updateRequired ? 'Update required' : !initializing && !user ? 'Sign in required' : undefined}
      >
        {(updateRequired || (!initializing && !user)) && <span className="chessr-fab-badge" />}
        <button
          className={`chessr-fab ${open ? 'chessr-fab--active' : 'chessr-fab--disabled'}`}
          onClick={() => open ? handleClose() : setOpen(true)}
          aria-label="Toggle Chessr"
        >
          <img src={browser.runtime.getURL('/icons/icon128.png')} alt="Chessr" width={54} height={54} style={{ marginTop: 4 }} />
        </button>
      </div>

      {open && (
        <div className="chessr-panel" ref={panelRef}>
          {loading ? (
            <Skeleton />
          ) : updateRequired ? (
            <div className="chessr-panel-body">
              <UpdateRequired />
            </div>
          ) : user ? (
            waitingForPlan ? (
              <div className="chessr-panel-body"><Skeleton /></div>
            ) : !premium ? (
              <>
                <PanelHeader showSettings={false} onToggleSettings={() => {}} hideActions />
                <div className="chessr-panel-body">
                  <BetaGate />
                </div>
              </>
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
    </>
  );
}
