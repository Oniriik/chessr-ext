import { useState } from 'react';
import { Crown, Hammer, Clock, Lock, LockOpen } from 'lucide-react';
import { Badge } from './badge';
import { Tooltip } from './tooltip';
import { cn } from '@/lib/utils';

export type Plan = 'lifetime' | 'beta' | 'premium' | 'freetrial' | 'free';

interface PlanBadgeProps {
  plan: Plan;
  expiry?: Date | null;
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
    bgColor: '#EAB308',
    textColor: '#574407',
  },
};

function getExpiryText(expiry: Date): string {
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'Expired';
  if (diffDays === 0) return 'Expires today';
  if (diffDays === 1) return 'Expires tomorrow';
  return `Expires in ${diffDays} days`;
}

const UPGRADE_URL = 'https://discord.gg/72j4dUadTu';

export function PlanBadge({ plan, expiry, className, compact }: PlanBadgeProps) {
  const config = planConfig[plan];
  const Icon = config.icon;

  // Show expiry tooltip for time-limited plans
  const hasExpiry = expiry && (plan === 'premium' || plan === 'freetrial');
  const tooltipContent = hasExpiry
    ? `${config.label} - ${getExpiryText(expiry)}`
    : plan === 'free'
      ? 'Click to upgrade'
      : config.label;

  const handleClick = () => {
    if (plan === 'free') {
      window.open(UPGRADE_URL, '_blank');
    }
  };

  const badgeElement = (
    <Badge
      variant="custom"
      className={cn(
        "tw-select-none tw-whitespace-nowrap",
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

  const badge = plan === 'free' ? (
    <button
      onClick={handleClick}
      className="tw-cursor-pointer hover:tw-opacity-80 tw-transition-opacity"
    >
      {badgeElement}
    </button>
  ) : badgeElement;

  // Always show tooltip for compact mode, expiry, or free plan
  if (compact || hasExpiry || plan === 'free') {
    return (
      <Tooltip content={tooltipContent} side="bottom">
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

  const handleClick = () => {
    window.open(UPGRADE_URL, '_blank');
  };

  if (variant === 'light') {
    return (
      <Tooltip content={tooltip} side="bottom">
        <button
          className="tw-p-0.5 tw-transition-all tw-cursor-pointer"
          style={{ color: '#eab308', opacity: hovered ? 1 : 0.4 }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={handleClick}
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
    <Tooltip content={tooltip} side="bottom">
      <button
        className="tw-p-1 tw-rounded tw-transition-all tw-cursor-pointer"
        style={{
          backgroundColor: '#4b5563',
          color: '#ffffff',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={handleClick}
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
