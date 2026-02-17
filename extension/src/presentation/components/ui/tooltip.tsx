import { useState, useRef, useEffect } from "react"
import { cn } from "../../lib/utils"

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Fixed-position tooltip that auto-adjusts to stay within viewport.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (visible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const padding = 8;

      // Default: centered below the trigger
      let top = triggerRect.bottom + padding;
      let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;

      // Adjust if tooltip goes off the right edge
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }

      // Adjust if tooltip goes off the left edge
      if (left < padding) {
        left = padding;
      }

      // If tooltip goes off bottom, show above
      if (top + tooltipRect.height > window.innerHeight - padding) {
        top = triggerRect.top - tooltipRect.height - padding;
      }

      setStyle({
        top,
        left,
        backgroundColor: 'hsl(233, 19%, 13%)',
        color: 'hsl(240, 6%, 90%)',
        border: '1px solid hsl(236, 20%, 25%)',
      });
    }
  }, [visible]);

  return (
    <span
      ref={triggerRef}
      className={cn("tw-inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          ref={tooltipRef}
          className="tw-fixed tw-z-[99999] tw-px-2 tw-py-1 tw-text-xs tw-font-medium tw-whitespace-nowrap tw-rounded-md tw-shadow-lg tw-pointer-events-none"
          style={style}
        >
          {content}
        </span>
      )}
    </span>
  );
}
