import { useState } from 'react';
import { Crown, Hammer, Clock, Lock, LockOpen } from 'lucide-react';
import { Badge } from './ui/badge';
import { Tooltip } from './ui/tooltip';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'free';

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
    bgColor: '#EAB308',
    textColor: '#574407',
  },
};

interface PlanBadgeProps {
  plan: Plan;
  className?: string;
  compact?: boolean;
}

export function PlanBadge({ plan, className, compact }: PlanBadgeProps) {
  const config = planConfig[plan];
  const Icon = config.icon;

  const badge = (
    <Badge
      className={`tw-select-none ${!compact ? 'tw-gap-1' : ''} ${className || ''}`}
      style={{
        backgroundColor: config.bgColor,
        color: config.textColor,
        padding: compact ? '4px' : '4px 8px',
      }}
    >
      <Icon className="tw-w-3 tw-h-3" />
      {!compact && <span>{config.label}</span>}
    </Badge>
  );

  if (compact) {
    return (
      <Tooltip content={config.label}>
        {badge}
      </Tooltip>
    );
  }

  return badge;
}

// Legacy exports for backwards compatibility
export function BetaBadge() {
  return <PlanBadge plan="beta" />;
}

export function UpgradeBadge() {
  return <PlanBadge plan="free" />;
}

interface UpgradeButtonProps {
  tooltip: string;
  variant?: 'default' | 'light';
}

export function UpgradeButton({ tooltip, variant = 'light' }: UpgradeButtonProps) {
  const [hovered, setHovered] = useState(false);

  if (variant === 'light') {
    return (
      <Tooltip content={tooltip}>
        <button
          className="tw-p-0.5 tw-transition-all"
          style={{ color: '#eab308', opacity: hovered ? 1 : 0.4 }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {hovered ? (
            <LockOpen className="tw-w-3.5 tw-h-3.5" strokeWidth={2.5} />
          ) : (
            <Lock className="tw-w-3.5 tw-h-3.5" strokeWidth={2.5} />
          )}
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={tooltip}>
      <button
        className="tw-p-1 tw-rounded tw-transition-all"
        style={{
          backgroundColor: '#4b5563',
          color: '#ffffff',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {hovered ? (
          <LockOpen className="tw-w-3 tw-h-3" strokeWidth={2.5} />
        ) : (
          <Lock className="tw-w-3 tw-h-3" strokeWidth={2.5} />
        )}
      </button>
    </Tooltip>
  );
}
