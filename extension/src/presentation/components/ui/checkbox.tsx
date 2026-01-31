import { cn } from '../../lib/utils';

interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ checked, onCheckedChange, disabled, className }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      disabled={disabled}
      className={cn(
        'tw-h-3.5 tw-w-3.5 tw-rounded tw-border tw-border-border tw-bg-background tw-cursor-pointer',
        'checked:tw-bg-primary checked:tw-border-primary',
        'focus:tw-outline-none focus:tw-ring-1 focus:tw-ring-primary focus:tw-ring-offset-1',
        'disabled:tw-cursor-not-allowed disabled:tw-opacity-50',
        className
      )}
    />
  );
}
