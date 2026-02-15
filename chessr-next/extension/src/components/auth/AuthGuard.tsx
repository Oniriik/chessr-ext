import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { AuthForm } from './AuthForm';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, initializing, initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  if (initializing) {
    return (
      <div className="tw-flex tw-items-center tw-justify-center tw-h-full tw-min-h-[200px]">
        <Loader2 className="tw-w-6 tw-h-6 tw-animate-spin tw-text-primary" />
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return <>{children}</>;
}
