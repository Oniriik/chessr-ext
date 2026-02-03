import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"
import { Zap, Crown } from "lucide-react"

const planBadgeVariants = cva(
  "tw-inline-flex tw-items-center tw-text-xs tw-gap-2 tw-px-2 tw-py-1 tw-rounded tw-text-white",
  {
    variants: {
      variant: {
        premium: "tw-bg-[#3B82F6]",
        upgrade: "tw-bg-[#fea31a]",
      },
    },
    defaultVariants: {
      variant: "premium",
    },
  }
)

export interface PlanBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof planBadgeVariants> {
}

function PlanBadge({ className, variant, ...props }: PlanBadgeProps) {
  const Icon = variant === "upgrade" ? Zap : Crown
  const iconBgClass = variant === "upgrade"
    ? "tw-bg-[#f18914] tw-bg-opacity-60"
    : "tw-bg-[#1e40af] tw-bg-opacity-60"

  return (
    <div className={cn(planBadgeVariants({ variant }), className)} {...props}>
      {variant === "premium" ? "Premium" : "Upgrade"}
      <div className={cn("tw-h-5 tw-w-5 tw-rounded tw-flex tw-items-center tw-justify-center", iconBgClass)}>
        <Icon className="tw-w-3 tw-h-3" strokeWidth={2} />
      </div>
    </div>
  )
}

export { PlanBadge, planBadgeVariants }
