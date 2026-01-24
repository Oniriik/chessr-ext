import { cn } from '../../lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'tw-inline-flex tw-items-center tw-justify-center tw-gap-2 tw-rounded-lg tw-text-sm tw-font-medium tw-transition-colors tw-cursor-pointer tw-border',
  {
    variants: {
      variant: {
        default: 'tw-bg-purple-600 tw-text-white tw-border-purple-600 hover:tw-bg-purple-700',
        outline: 'tw-bg-transparent tw-text-gray-400 tw-border-gray-600 hover:tw-bg-gray-700',
        ghost: 'tw-bg-transparent tw-border-0 tw-text-gray-400 hover:tw-bg-gray-700',
      },
      size: {
        default: 'tw-py-2.5 tw-px-4',
        sm: 'tw-py-1.5 tw-px-3 tw-text-xs',
        icon: 'tw-p-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
