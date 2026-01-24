import { cn } from '../../lib/utils';

interface SliderProps {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
}

export function Slider({ value, onValueChange, min, max, step = 1, className }: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange(Number(e.target.value))}
      className={cn(
        'tw-w-full tw-h-1.5 tw-bg-gray-700 tw-rounded-lg tw-appearance-none tw-cursor-pointer tw-accent-yellow-400',
        className
      )}
    />
  );
}
