import { createContext, useContext } from 'react';

/**
 * Context to provide a container element for Radix UI portals.
 * This ensures portaled content (dropdowns, modals, etc.) renders
 * inside the extension's root element rather than document.body,
 * preserving CSS scoping and preventing layout shifts.
 */
const PortalContainerContext = createContext<HTMLElement | null>(null);

export const PortalContainerProvider = PortalContainerContext.Provider;

export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
