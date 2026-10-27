import * as React from "react";
import { cn } from "../../lib/utils";

type CardProps = React.ComponentProps<"div"> & { variant?: "surface" | "outlined" | "filled" | "elevated" };

function Card({ className, variant = "surface", ...props }: CardProps) {
  return <div data-slot="card" data-variant={variant} className={cn(
    "flex flex-col rounded-[var(--md-sys-shape-corner-medium)] text-card-foreground",
    variant === "outlined" && "border border-border bg-card [--md-field-background:var(--card)]",
    // Workspace grouping is a Google console adaptation, not a Material filled card.
    variant === "surface" && "border-0 bg-card [--md-field-background:var(--card)]",
    variant === "filled" && "border-0 bg-[var(--md-sys-color-surface-container-highest)] [--md-field-background:var(--md-sys-color-surface-container-highest)]",
    variant === "elevated" && "border-0 bg-[var(--md-sys-color-surface-container-low)] shadow-[var(--md-sys-elevation-level-1)] [--md-field-background:var(--md-sys-color-surface-container-low)]",
    className,
  )} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1 px-5 pb-3 pt-4", className)} {...props} />;
}

function CardTitle({ className, as = "h2", ...props }: React.ComponentProps<"h2"> & { as?: "h2" | "h3" }) {
  const Heading = as;
  return <Heading className={cn("md-title-large", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("md-body-medium text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 pb-4", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };
