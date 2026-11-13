import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Estilo Stripe: etiqueta suave, esquina de 4 px, sin borde, 12 px medio.
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[5px] border border-transparent px-1.5 py-0.5 text-xs font-medium leading-4 transition-colors focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-red-500/10 text-red-400",
        outline: "border-border text-foreground",
        success: "bg-emerald-500/10 text-emerald-400",
        warning: "bg-amber-500/15 text-amber-400",
        info: "bg-sky-500/10 text-sky-400",
        muted: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
