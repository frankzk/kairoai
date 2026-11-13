import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Estilo Stripe: 32 px de alto, 13,5 px, borde fino y sombra mínima; foco
  // con anillo índigo suave (sin desplazamiento).
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-[13.5px] font-medium leading-none transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_1px_rgb(20_20_31/0.12),inset_0_1px_0_rgb(255_255_255/0.14)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_1px_rgb(20_20_31/0.12)] hover:bg-destructive/90",
        outline:
          "border border-input bg-card text-foreground shadow-[0_1px_1px_rgb(20_20_31/0.04)] hover:bg-muted",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-muted",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-8 px-2.5",
        lg: "h-9 px-4",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
