import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "../../lib/utils";

type InputProps = Omit<InputPrimitive.Props, "className"> & { className?: string };

function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn("h-14 w-full rounded-[var(--md-sys-shape-corner-extra-small)] border border-[var(--md-sys-color-outline)] bg-transparent px-4 text-base leading-6 tracking-[0.5px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground enabled:hover:border-foreground focus:border-primary focus:shadow-[inset_0_0_0_1px_var(--md-sys-color-primary)] disabled:cursor-not-allowed disabled:border-foreground/12 disabled:text-foreground/38 disabled:placeholder:text-foreground/38 aria-invalid:border-destructive aria-invalid:focus:shadow-[inset_0_0_0_1px_var(--md-sys-color-error)]", className)}
      {...props}
    />
  );
}

export { Input, type InputProps };
