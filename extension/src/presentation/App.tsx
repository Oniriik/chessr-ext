import React, { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { AuthForm } from './components/AuthForm';
import { CounterOpeningPrompt } from './components/CounterOpeningPrompt';
import { CriticalUpdateModal } from './components/CriticalUpdateModal';
import { UpdateRequiredView } from './components/UpdateRequiredView';
import { useAppStore } from './store/app.store';
import { useAuthStore } from './store/auth.store';
import { Loader2 } from 'lucide-react';
import './styles.css';

export function App() {
  const { loadSettings, syncWithCloud, updateRequired, updateDismissed } = useAppStore();
  const { user, loading, initialize } = useAuthStore();

  // Initialize auth on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Load and sync settings when auth state changes
  useEffect(() => {
    if (!loading) {
      if (user) {
        // User logged in - sync with cloud
        syncWithCloud(user.id);
      } else {
        // No user - just load local settings
        loadSettings();
      }
    }
  }, [user, loading, loadSettings, syncWithCloud]);

  // Show critical update modal if update is required and not dismissed
  if (updateRequired && !updateDismissed) {
    return <CriticalUpdateModal />;
  }

  // Show limited view if update dismissed (no settings, just update prompt)
  if (updateRequired && updateDismissed) {
    return <UpdateRequiredView />;
  }

  // Show loading while auth is initializing
  if (loading) {
    return (
      <div className="tw-fixed tw-right-0 tw-top-0 tw-h-screen tw-w-72 tw-bg-background tw-flex tw-items-center tw-justify-center tw-font-sans">
        <Loader2 className="tw-w-8 tw-h-8 tw-text-primary tw-animate-spin" />
      </div>
    );
  }

  // Show auth form if not logged in
  if (!user) {
    return (
      <div className="tw-fixed tw-right-0 tw-top-0 tw-h-screen tw-w-72 tw-bg-background tw-flex tw-flex-col tw-font-sans">
        <div className="tw-flex tw-items-center tw-gap-2 tw-p-4 tw-border-b tw-border-gray-700">
          <span className="tw-font-semibold tw-text-sm">Chessr</span>
        </div>
        <AuthForm />
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <CounterOpeningPrompt />
    </>
  );
}
