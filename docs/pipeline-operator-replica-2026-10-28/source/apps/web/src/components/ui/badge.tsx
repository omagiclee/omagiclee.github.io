import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/** Business status labels use readable chip-sized containers. This is not the
 * 6dp/16dp notification badge attached to an icon in the Material badge spec. */
const badgeVariants = cva("inline-flex min-h-8 w-fit shrink-0 items-center gap-1.5 rounded-[var(--md-sys-shape-corner-small)] border px-3 py-1 text-sm font-medium leading-5 tracking-[0.1px]", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      outline: "border-[var(--md-sys-color-outline)] bg-transparent text-foreground",
      warning: "border-transparent bg-[var(--md-sys-color-warning-container)] text-[var(--md-sys-color-on-warning-container)]",
      success: "border-transparent bg-[var(--md-sys-color-success-container)] text-[var(--md-sys-color-on-success-container)]",
      info: "border-transparent bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]",
      destructive: "border-transparent bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" data-variant={variant ?? "default"} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
