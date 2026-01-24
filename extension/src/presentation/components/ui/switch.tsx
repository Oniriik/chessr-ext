import { cn } from '../../lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export function Switch({ checked, onCheckedChange, className }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'tw-relative tw-w-11 tw-h-6 tw-rounded-full tw-transition-colors tw-cursor-pointer tw-border-0',
        checked ? 'tw-bg-primary' : 'tw-bg-border',
        className
      )}
    >
      <span
        className={cn(
          'tw-absolute tw-top-0.5 tw-w-5 tw-h-5 tw-bg-white tw-rounded-full tw-transition-all',
          checked ? 'tw-left-5' : 'tw-left-0.5'
        )}
      />
    </button>
  );
}
