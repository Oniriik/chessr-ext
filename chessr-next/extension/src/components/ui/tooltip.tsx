import * as React from "react"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

/**
 * Simple CSS-based tooltip that doesn't use portals.
 * Avoids DOM layout shifts in browser extension context.
 */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const sideClasses = {
    top: 'tw-bottom-full tw-left-1/2 tw--translate-x-1/2 tw-mb-2',
    bottom: 'tw-top-full tw-left-1/2 tw--translate-x-1/2 tw-mt-2',
    left: 'tw-right-full tw-top-1/2 tw--translate-y-1/2 tw-mr-2',
    right: 'tw-left-full tw-top-1/2 tw--translate-y-1/2 tw-ml-2',
  };

  return (
    <span className={cn("tw-relative tw-inline-flex tw-group", className)}>
      {children}
      <span
        className={cn(
          "tw-absolute tw-z-[9999] tw-px-2 tw-py-1 tw-text-xs tw-font-medium tw-whitespace-nowrap tw-rounded-md tw-shadow-lg tw-pointer-events-none",
          "tw-opacity-0 tw-invisible group-hover:tw-opacity-100 group-hover:tw-visible tw-transition-opacity tw-duration-200",
          sideClasses[side]
        )}
        style={{
          backgroundColor: 'hsl(233, 19%, 13%)',
          color: 'hsl(240, 6%, 90%)',
          border: '1px solid hsl(236, 20%, 25%)',
        }}
      >
        {content}
      </span>
    </span>
  );
}
