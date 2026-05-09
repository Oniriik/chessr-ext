'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { cn } from '@/lib/utils';

// Thin shadcn-style wrapper around react-day-picker v10. Styled to match
// the dashboard's tokens: card surface, primary-tinted selection, muted
// outside days. Caller passes `mode`, `selected`, `onSelect` etc.
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-3',
        month: 'flex flex-col gap-3',
        month_caption: 'flex items-center justify-center pt-1 text-[13px] font-medium',
        nav: 'flex items-center gap-1 absolute right-3 top-3',
        button_previous:
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30',
        button_next:
          'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-muted-foreground/70 w-9 text-[10px] font-medium uppercase tracking-wider',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 p-0 text-center text-[12px]',
        day_button:
          'inline-flex h-9 w-9 items-center justify-center rounded-md font-normal transition-colors hover:bg-muted aria-selected:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring',
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/90',
        today: '[&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-primary/40',
        outside: 'text-muted-foreground/40',
        disabled: 'text-muted-foreground/30 cursor-not-allowed',
        range_middle: '[&>button]:bg-muted [&>button]:text-foreground',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left'
            ? <ChevronLeft size={14} strokeWidth={2.2} />
            : <ChevronRight size={14} strokeWidth={2.2} />,
      }}
      {...props}
    />
  );
}
Calendar.displayName = 'Calendar';

export { Calendar };
