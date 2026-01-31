import { cn } from '../../lib/utils';

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  disabled?: boolean;
}

export function Slider({ value, onValueChange, min, max, step = 1, className, disabled = false }: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange(Number(e.target.value))}
      disabled={disabled}
      className={cn(
        'tw-w-full tw-h-1.5 tw-bg-border tw-rounded-lg tw-appearance-none tw-cursor-pointer tw-accent-primary',
        disabled && 'tw-opacity-50 tw-cursor-not-allowed',
        className
      )}
    />
  );
}
