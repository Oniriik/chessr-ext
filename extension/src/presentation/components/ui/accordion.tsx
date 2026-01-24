import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface AccordionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Accordion({ title, defaultOpen = false, children }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="tw-rounded-lg tw-bg-card">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="tw-w-full tw-flex tw-items-center tw-justify-between tw-p-4 tw-text-left"
      >
        <span className="tw-text-xs tw-uppercase tw-text-muted tw-tracking-wider">{title}</span>
        <ChevronDown
          className={cn(
            'tw-w-4 tw-h-4 tw-text-muted tw-transition-transform tw-duration-200',
            isOpen && 'tw-rotate-180'
          )}
        />
      </button>
      {isOpen && (
        <div className="tw-px-4 tw-pb-4 tw-pt-0">
          {children}
        </div>
      )}
    </div>
  );
}
