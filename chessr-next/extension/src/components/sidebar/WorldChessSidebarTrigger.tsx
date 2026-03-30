import { useEffect, useRef } from 'react';
import { useSidebar } from '../../hooks/useSidebar';
import { useStreamerModeStore } from '../../stores/streamerModeStore';

/**
 * Clone a native WorldChess HeaderToolsItem and replace its content with Chessr logo.
 * This ensures we inherit all current classes/styles even if they change via SSR.
 */
export function WorldChessHeaderTrigger() {
  const { isOpen, toggle } = useSidebar();
  const isStreamerTabOpen = useStreamerModeStore((s) => s.isStreamerTabOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    // Find a native HeaderToolsItem to clone its structure
    const nativeItem = document.querySelector('[data-component="HeaderToolsItem"][data-id="Themes"]');
    if (!nativeItem) return;

    // Clone the outer wrapper
    const clone = nativeItem.cloneNode(false) as HTMLElement;
    clone.setAttribute('data-id', 'chessr');
    clone.style.cursor = 'pointer';

    // Build inner content matching the native structure
    clone.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;padding:4px">
        <div style="display:flex;align-items:center;justify-content:center">
          <img src="${logoUrl}" alt="Chessr" width="24" height="24" style="border-radius:4px;opacity:${isOpen ? '1' : '0.7'};transition:opacity 0.2s" />
        </div>
      </div>
    `;

    clone.addEventListener('click', toggle);
    clone.title = isOpen ? 'Hide Chessr' : 'Show Chessr';

    // Clear and append
    container.innerHTML = '';
    container.appendChild(clone);

    return () => {
      clone.removeEventListener('click', toggle);
    };
  }, [isOpen, toggle, logoUrl]);

  if (isStreamerTabOpen) return null;

  return <div ref={containerRef} style={{ display: 'contents' }} />;
}

/**
 * Inject a cloned GameToolbarItem directly into the GameToolbar DOM.
 * Bypasses React mount container to avoid display:contents issues.
 */
export function WorldChessToolbarTrigger() {
  const { isOpen, toggle } = useSidebar();
  const isStreamerTabOpen = useStreamerModeStore((s) => s.isStreamerTabOpen);
  const logoUrl = chrome.runtime.getURL('icons/chessr-logo.png');
  const cloneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const toolbar = document.querySelector('[data-component="GameToolbar"]');
    const nativeItem = document.querySelector('[data-component="GameToolbarItem"]');
    if (!toolbar || !nativeItem) return;

    // Remove previous clone if any
    if (cloneRef.current?.isConnected) cloneRef.current.remove();

    // Clone outer wrapper
    const clone = nativeItem.cloneNode(false) as HTMLElement;
    clone.setAttribute('data-id', 'chessr');
    clone.id = 'chessr-toolbar-trigger';
    clone.style.cursor = 'pointer';

    // Clone inner structure
    const innerWrapper = nativeItem.children[0];
    if (innerWrapper) {
      const innerClone = innerWrapper.cloneNode(false) as HTMLElement;

      // Icon area
      const nativeIconArea = innerWrapper.children[0];
      if (nativeIconArea) {
        const iconClone = nativeIconArea.cloneNode(false) as HTMLElement;
        iconClone.innerHTML = `<img src="${logoUrl}" alt="Chessr" width="20" height="20" style="border-radius:3px;opacity:${isOpen ? '1' : '0.7'};transition:opacity 0.2s" />`;
        innerClone.appendChild(iconClone);
      }

      // Label area
      const nativeLabelArea = innerWrapper.children[1];
      if (nativeLabelArea) {
        const labelClone = nativeLabelArea.cloneNode(false) as HTMLElement;
        labelClone.textContent = 'Chessr';
        if (isOpen) labelClone.style.color = '#3c83f6';
        innerClone.appendChild(labelClone);
      }

      clone.appendChild(innerClone);
    }

    clone.addEventListener('click', toggle);
    clone.title = isOpen ? 'Hide Chessr' : 'Show Chessr';

    // Insert before the "More" button (last item)
    const moreButton = toolbar.querySelector('[data-component="GameToolbarMore"]');
    if (moreButton) {
      toolbar.insertBefore(clone, moreButton);
    } else {
      toolbar.appendChild(clone);
    }

    cloneRef.current = clone;

    return () => {
      clone.removeEventListener('click', toggle);
      if (clone.isConnected) clone.remove();
    };
  }, [isOpen, toggle, logoUrl]);

  if (isStreamerTabOpen) return null;

  // No visible React output — everything is injected directly into DOM
  return null;
}
