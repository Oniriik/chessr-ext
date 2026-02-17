import { cn } from '../../lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export function Switch({ checked, onCheckedChange, className, disabled }: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onCheckedChange(!checked)}
      disabled={disabled}
      className={cn(
        'tw-relative tw-w-8 tw-h-[18px] tw-rounded-full tw-transition-colors tw-border-0',
        disabled ? 'tw-cursor-not-allowed tw-opacity-50' : 'tw-cursor-pointer',
        checked ? 'tw-bg-primary' : 'tw-bg-border',
        className
      )}
    >
      <span
        className={cn(
          'tw-absolute tw-top-0.5 tw-w-[14px] tw-h-[14px] tw-bg-white tw-rounded-full tw-transition-all',
          checked ? 'tw-left-[16px]' : 'tw-left-0.5'
        )}
      />
    </button>
  );
}
