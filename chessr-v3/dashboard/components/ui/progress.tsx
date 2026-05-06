'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '@/lib/utils';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** Override the bar color tier — by default we color from green→amber→red
   *  based on `value`, which fits CPU/RAM/storage gauges. Pass an explicit
   *  className via `indicatorClassName` to opt out. */
  indicatorClassName?: string;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ className, value, indicatorClassName, ...props }, ref) => {
    const v = typeof value === 'number' ? value : 0;
    // Tier colors that match the dark theme:
    //   <70  → emerald (healthy)
    //   <85  → amber   (warning)
    //   else → red     (critical)
    const tier =
      v < 70 ? 'bg-emerald-500'
      : v < 85 ? 'bg-amber-500'
      : 'bg-red-500';

    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn('h-full w-full flex-1 transition-all duration-500 ease-out', indicatorClassName ?? tier)}
          style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, v))}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  },
);
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
