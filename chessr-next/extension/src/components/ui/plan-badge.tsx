import { Crown, Hammer, Clock, Lock } from 'lucide-react';
import { Badge } from './badge';
import { Tooltip } from './tooltip';
import { cn } from '@/lib/utils';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'free';

interface PlanBadgeProps {
  plan: Plan;
  className?: string;
  /** Force compact mode (icon only with tooltip) */
  compact?: boolean;
}

const planConfig: Record<Plan, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  bgColor: string;
  textColor: string;
}> = {
  lifetime: {
    label: 'Lifetime',
    icon: Crown,
    bgColor: '#8263F1',
    textColor: '#3F2F7A',
  },
  beta: {
    label: 'Beta',
    icon: Hammer,
    bgColor: '#6366f1',
    textColor: '#252972',
  },
  premium: {
    label: 'Premium',
    icon: Crown,
    bgColor: '#60a5fa',
    textColor: '#264A70',
  },
  freetrial: {
    label: 'Free trial',
    icon: Clock,
    bgColor: '#9c4040',
    textColor: '#481A1A',
  },
  free: {
    label: 'Upgrade',
    icon: Lock,
    bgColor: '#4b5563',
    textColor: '#ffffff',
  },
};

export function PlanBadge({ plan, className, compact }: PlanBadgeProps) {
  const config = planConfig[plan];
  const Icon = config.icon;

  const badge = (
    <Badge
      variant="custom"
      className={cn(
        "tw-select-none",
        !compact && "tw-gap-1.5",
        className
      )}
      style={{
        backgroundColor: config.bgColor,
        color: config.textColor,
        padding: compact ? '8px' : '8px 16px',
      }}
    >
      <Icon className="tw-w-4 tw-h-4" />
      {!compact && <span>{config.label}</span>}
    </Badge>
  );

  if (compact) {
    return (
      <Tooltip content={config.label} side="bottom">
        {badge}
      </Tooltip>
    );
  }

  return badge;
}
