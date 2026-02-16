import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSidebar } from '../../hooks/useSidebar';
import { SidebarContent } from './SidebarContent';
import { PortalContainerProvider } from '../../contexts/PortalContainerContext';

interface SidebarPortalProps {
  /** Selector of the original sidebar to hide/show */
  originalSidebarSelector: string;
  /** Class to inherit from the original sidebar for styling */
  inheritClass?: string;
}

export function SidebarPortal({ originalSidebarSelector, inheritClass }: SidebarPortalProps) {
  const { isOpen } = useSidebar();
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const originalSidebar = document.querySelector(originalSidebarSelector) as HTMLElement;
    if (!originalSidebar) return;

    // Get or create Chessr sidebar container
    let chessrSidebar = document.getElementById('chessr-sidebar');

    if (!chessrSidebar) {
      // Create new sidebar
      chessrSidebar = document.createElement('div');
      chessrSidebar.id = 'chessr-sidebar';
    }

    // Always update class and position (in case route changed)
    chessrSidebar.className = inheritClass ? `chessr-sidebar-container ${inheritClass}` : 'chessr-sidebar-container';

    // Move to correct position (after the original sidebar)
    if (chessrSidebar.parentNode !== originalSidebar.parentNode ||
        chessrSidebar.previousSibling !== originalSidebar) {
      originalSidebar.parentNode?.insertBefore(chessrSidebar, originalSidebar.nextSibling);
    }

    // Apply initial visibility based on current state
    if (isOpen) {
      originalSidebar.style.display = 'none';
      chessrSidebar.style.display = 'block';
    } else {
      originalSidebar.style.display = '';
      chessrSidebar.style.display = 'none';
    }

    setContainer(chessrSidebar);

    return () => {
      // Restore original sidebar visibility on unmount
      const origSidebar = document.querySelector(originalSidebarSelector) as HTMLElement;
      if (origSidebar) {
        origSidebar.style.display = '';
      }
    };
  }, [originalSidebarSelector, inheritClass, isOpen]);

  // Toggle visibility when isOpen changes
  useEffect(() => {
    const originalSidebar = document.querySelector(originalSidebarSelector) as HTMLElement;
    const chessrSidebar = document.getElementById('chessr-sidebar');

    if (originalSidebar && chessrSidebar) {
      if (isOpen) {
        originalSidebar.style.display = 'none';
        chessrSidebar.style.display = 'block';
      } else {
        originalSidebar.style.display = '';
        chessrSidebar.style.display = 'none';
      }
    }
  }, [isOpen, originalSidebarSelector]);

  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  // Create portal container for dropdowns/modals inside the sidebar
  useEffect(() => {
    if (!container) return;

    let portalEl = container.querySelector('#chessr-portal-container') as HTMLElement;
    if (!portalEl) {
      portalEl = document.createElement('div');
      portalEl.id = 'chessr-portal-container';
      portalEl.className = 'tw-absolute tw-inset-0 tw-pointer-events-none tw-z-50';
      portalEl.style.position = 'relative';
      container.appendChild(portalEl);
    }
    setPortalContainer(portalEl);
  }, [container]);

  if (!container) return null;

  return createPortal(
    <PortalContainerProvider value={portalContainer}>
      <div id="chessr-root" className="tw-h-full tw-relative">
        <SidebarContent />
      </div>
    </PortalContainerProvider>,
    container
  );
}
