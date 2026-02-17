import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function Badge({ children, className, style }: BadgeProps) {
  return (
    <div
      className={cn(
        'tw-inline-flex tw-items-center tw-rounded-full tw-px-2 tw-py-0.5 tw-text-xs tw-font-semibold tw-select-none',
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
}
