import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-white hover:bg-accent-hover",
        neutral:
          "bg-layer-2 text-txt-primary hover:bg-layer-3",
        outline:
          "border border-border-strong text-txt-primary hover:bg-layer-2",
        ghost: "text-txt-secondary hover:bg-layer-2 hover:text-txt-primary",
        danger:
          "bg-danger text-white hover:bg-danger/90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-6 px-2 text-[11px]",
        sm: "h-7 px-3 text-[12px]",
        md: "h-8 px-3 text-[13px]",
        lg: "h-9 px-4 text-[13px]",
        icon: "h-8 w-8",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
