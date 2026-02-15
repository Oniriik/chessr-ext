import { createRoot, Root } from 'react-dom/client';
import { getPlatformContext, MountPoint, RouteId } from '../platforms';
import { PlatformProvider } from '../contexts/PlatformContext';
import '../styles/content.css';

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

  // Already mounted
  if (mountedRoots.has(mountPoint.id)) return;

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
  const url = new URL(window.location.href);
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

// Initial mount
updateMounts();

// Watch for URL changes (SPA navigation)
let lastUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    updateMounts();
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Also listen for popstate (back/forward navigation)
window.addEventListener('popstate', updateMounts);
