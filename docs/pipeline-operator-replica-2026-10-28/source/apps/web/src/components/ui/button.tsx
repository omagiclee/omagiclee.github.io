import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "md-button inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-transparent p-0 whitespace-nowrap text-sm font-medium leading-5 tracking-[0.1px] outline-none transition-[color] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "text-primary-foreground",
        elevated: "text-primary",
        secondary: "text-secondary-foreground",
        outline: "text-primary",
        ghost: "text-primary",
        link: "text-primary underline underline-offset-4",
        destructive: "text-[var(--md-sys-color-on-error)]",
        "destructive-text": "text-destructive",
      },
      size: {
        default: "min-w-12",
        sm: "min-w-12",
        icon: "size-12 [&_svg]:size-6",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = Omit<ButtonPrimitive.Props, "className"> & VariantProps<typeof buttonVariants> & { className?: string };

function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return <ButtonPrimitive data-slot="button" data-variant={variant ?? "default"} data-size={size ?? "default"} className={cn(buttonVariants({ variant, size, className }))} {...props}>
    <span className="md-button-container md-state-layer">{children}</span>
  </ButtonPrimitive>;
}

export { Button, buttonVariants, type ButtonProps };
