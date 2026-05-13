import { useEffect, useState } from 'react';
import { useAuthStore } from './stores/authStore';
import { connectWs, disconnectWs } from './lib/websocket';
import AuthScreen from './components/AuthScreen';
import ReviewView from './components/ReviewView';
import SettingsScreen from './components/SettingsScreen';
import Header from './components/Header';

type View = 'review' | 'settings';

export default function Popup() {
  const { user, initializing, initialize } = useAuthStore();
  const [view, setView] = useState<View>('review');

  useEffect(() => { initialize(); }, []);

  useEffect(() => {
    if (user?.id) connectWs(user.id);
  }, [user?.id]);

  useEffect(() => {
    if (!user) disconnectWs();
  }, [user]);

  // Drop back to review whenever the user signs in/out — settings view
  // implicitly only makes sense for an authed session.
  useEffect(() => {
    if (!user) setView('review');
  }, [user?.id]);

  const toggleSettings = () => setView((v) => (v === 'settings' ? 'review' : 'settings'));

  if (initializing) {
    return (
      <div className="popup">
        <Header view={view} onToggleSettings={toggleSettings} />
        <div className="popup-body popup-center">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="popup">
      <Header view={view} onToggleSettings={toggleSettings} />
      <div className="popup-body">
        {!user ? <AuthScreen /> : view === 'settings' ? <SettingsScreen onBack={toggleSettings} /> : <ReviewView />}
      </div>
    </div>
  );
}
