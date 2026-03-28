import { createRoot, Root } from 'react-dom/client';
import { getPlatformContext, MountPoint, RouteId } from '../platforms';
import { PlatformProvider } from '../contexts/PlatformContext';
import { initAnonymousBlur, rescanAnonymousBlur, getRealHref } from './anonymousBlur';
import { initTitleSimulator, rescanTitleSimulator } from './titleSimulator';
import { initStreamerBridge } from '../lib/streamerBridge';
import { useDiscordStore } from '../stores/discordStore';
import '../styles/content.css';
import '../i18n/i18n';

console.log('[Chessr] Content script loaded');

const mountedRoots: Map<string, { root: Root; container: HTMLElement }> = new Map();

function matchesRoute(mountRoute: RouteId | RouteId[], currentRoute: RouteId): boolean {
  if (Array.isArray(mountRoute)) {
    return mountRoute.includes(currentRoute);
  }
  return mountRoute === currentRoute;
}

function mountComponent(mountPoint: MountPoint, context: ReturnType<typeof getPlatformContext>) {
  if (!context) return;

  const targetElement = document.querySelector(mountPoint.selector);
  if (!targetElement) return;

  // Already mounted — but check if container is still in the document
  const existing = mountedRoots.get(mountPoint.id);
  if (existing) {
    if (existing.container.isConnected) return;
    // Container was detached (SPA re-render), clean up and re-mount
    existing.root.unmount();
    mountedRoots.delete(mountPoint.id);
  }

  const container = document.createElement('div');
  container.id = `chessr-${mountPoint.id}`;
  container.className = 'chessr-mount';

  // Determine the parent element for styles
  let parentForStyles: Element | null = null;

  switch (mountPoint.position) {
    case 'before':
      targetElement.parentNode?.insertBefore(container, targetElement);
      parentForStyles = targetElement.parentElement;
      break;
    case 'after':
      targetElement.parentNode?.insertBefore(container, targetElement.nextSibling);
      parentForStyles = targetElement.parentElement;
      break;
    case 'prepend':
      targetElement.insertBefore(container, targetElement.firstChild);
      parentForStyles = targetElement;
      break;
    case 'append':
      targetElement.appendChild(container);
      parentForStyles = targetElement;
      break;
  }

  // Apply container styles if specified
  if (mountPoint.containerStyles) {
    Object.assign(container.style, mountPoint.containerStyles);
  }

  // Apply parent styles if specified
  if (mountPoint.parentStyles && parentForStyles instanceof HTMLElement) {
    Object.assign(parentForStyles.style, mountPoint.parentStyles);
  }

  const root = createRoot(container);
  const Component = mountPoint.component;
  const props = (mountPoint.props || {}) as Record<string, unknown>;

  root.render(
    <PlatformProvider value={context}>
      <Component {...props} />
    </PlatformProvider>
  );

  mountedRoots.set(mountPoint.id, { root, container });
}

function unmountComponent(mountPointId: string) {
  const mounted = mountedRoots.get(mountPointId);
  if (!mounted) return;

  mounted.root.unmount();
  mounted.container.remove();
  mountedRoots.delete(mountPointId);
}

function updateMounts() {
  const url = new URL(getRealHref());
  const context = getPlatformContext(url);

  if (!context) return;

  const mountPoints = context.platform.getMountPoints();
  const currentRoute = context.route;

  // Mount components for current route
  for (const mountPoint of mountPoints) {
    if (matchesRoute(mountPoint.route, currentRoute)) {
      mountComponent(mountPoint, context);
    } else {
      unmountComponent(mountPoint.id);
    }
  }
}

// Handle Discord OAuth redirect query params
(() => {
  const url = new URL(window.location.href);
  const discordLinked = url.searchParams.get('discord_linked');
  const discordError = url.searchParams.get('discord_error');

  if (discordLinked || discordError) {
    // Clean up query params from URL
    url.searchParams.delete('discord_linked');
    url.searchParams.delete('discord_error');
    window.history.replaceState({}, '', url.toString());

    // Reset linking state
    useDiscordStore.getState().setLinking(false);

    if (discordError) {
      const errorMessages: Record<string, string> = {
        denied: 'Discord authorization was denied.',
        expired: 'Link expired. Please try again.',
        already_linked: 'This Discord account is already linked to another Chessr account.',
        token_failed: 'Failed to connect to Discord. Please try again.',
        fetch_failed: 'Failed to fetch Discord account info. Please try again.',
        save_failed: 'Failed to save Discord link. Please try again.',
        unknown: 'An unknown error occurred. Please try again.',
      };
      console.warn(`[Chessr] Discord link error: ${discordError}`);
      // Brief toast-like notification
      const toast = document.createElement('div');
      toast.textContent = errorMessages[discordError] || errorMessages.unknown;
      toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:999999;background:#dc2626;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;font-family:system-ui;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 5000);
    }
  }
})();

// Initial mount
updateMounts();

// Initialize anonymous blur for platform page elements
initAnonymousBlur();

// Initialize title simulator for chess.com
initTitleSimulator();

// Watch for URL changes and DOM updates (SPA navigation + async rendering)
let lastUrl = getRealHref();
const observer = new MutationObserver(() => {
  const currentReal = getRealHref();
  if (currentReal !== lastUrl) {
    lastUrl = currentReal;
    updateMounts();
    rescanAnonymousBlur();
    rescanTitleSimulator();
  } else {
    // Retry mounting components whose selectors weren't found initially
    updateMounts();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Also listen for popstate (back/forward navigation)
window.addEventListener('popstate', () => {
  updateMounts();
  rescanAnonymousBlur();
  rescanTitleSimulator();
});

// Initialize streamer mode bridge (connects to background service worker)
initStreamerBridge();
