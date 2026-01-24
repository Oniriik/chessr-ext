import { cn } from '../../lib/utils';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
}

export function Select({ value, onValueChange, options, className }: SelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      className={cn(
        'tw-w-full tw-bg-card tw-border tw-border-border tw-rounded-md tw-px-3 tw-py-2',
        'tw-text-sm tw-text-foreground tw-cursor-pointer',
        'focus:tw-outline-none focus:tw-ring-2 focus:tw-ring-primary focus:tw-border-transparent',
        'hover:tw-border-muted tw-transition-colors',
        className
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="tw-bg-card">
          {option.label}
        </option>
      ))}
    </select>
  );
}
