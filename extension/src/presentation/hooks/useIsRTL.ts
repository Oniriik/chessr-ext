import { useState, useEffect } from 'react';

/**
 * Hook to detect if the page is in RTL (right-to-left) mode
 * Checks document.documentElement.dir and document.body.dir
 * Also observes for changes in case it changes dynamically
 */
export function useIsRTL(): boolean {
  const [isRTL, setIsRTL] = useState(() => {
    if (typeof document === 'undefined') return false;
    const dir = document.documentElement.dir || document.body.dir;
    return dir === 'rtl';
  });

  useEffect(() => {
    const checkRTL = () => {
      const dir = document.documentElement.dir || document.body.dir;
      setIsRTL(dir === 'rtl');
    };

    // Check immediately
    checkRTL();

    // Observe changes to dir attribute on html and body
    const observer = new MutationObserver(checkRTL);

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir'],
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['dir'],
    });

    return () => observer.disconnect();
  }, []);

  return isRTL;
}
