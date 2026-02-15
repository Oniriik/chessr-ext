import { createContext, useContext, ReactNode } from 'react';
import { PlatformContext as PlatformContextType } from '../platforms/types';

const PlatformContext = createContext<PlatformContextType | null>(null);

interface PlatformProviderProps {
  value: PlatformContextType;
  children: ReactNode;
}

export function PlatformProvider({ value, children }: PlatformProviderProps) {
  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformContextType {
  const context = useContext(PlatformContext);
  if (!context) {
    throw new Error('usePlatform must be used within a PlatformProvider');
  }
  return context;
}
