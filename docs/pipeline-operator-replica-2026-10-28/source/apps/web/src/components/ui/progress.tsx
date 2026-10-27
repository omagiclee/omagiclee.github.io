import * as React from "react";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "../../lib/utils";
import "./progress.css";

type ProgressProps = Omit<ProgressPrimitive.Root.Props, "className"> & { className?: string };

function Progress({ className, value, min = 0, max = 100, style, children, ...props }: ProgressProps) {
  const validRange = Number.isFinite(min) && Number.isFinite(max) && max > min;
  const safeMin = validRange ? min : 0;
  const safeMax = validRange ? max : 100;
  const safeValue = value != null && Number.isFinite(value)
    ? Math.min(safeMax, Math.max(safeMin, value))
    : null;
  const percentage = safeValue != null ? (safeValue - safeMin) / (safeMax - safeMin) * 100 : 0;
  const progressStyle: React.CSSProperties & { "--md-progress-value": string; "--md-progress-gap": string } = {
    "--md-progress-value": `${percentage}%`,
    "--md-progress-gap": percentage > 0 && percentage < 100 ? "4px" : "0px",
  };
  return (
    <ProgressPrimitive.Root data-slot="progress" className={cn("md-linear-progress", className)} value={safeValue} min={safeMin} max={safeMax} aria-valuetext={safeValue == null ? "进度尚未确定" : undefined} style={(state) => ({ ...progressStyle, ...(typeof style === "function" ? style(state) : style) })} {...props}>
      <span className="md-linear-progress-track" aria-hidden="true" />
      <span className="md-linear-progress-track-leading" aria-hidden="true" />
      <ProgressPrimitive.Indicator className="md-linear-progress-indicator" />
      <span className="md-linear-progress-stop" aria-hidden="true" />
      {children}
    </ProgressPrimitive.Root>
  );
}

export { Progress, type ProgressProps };
