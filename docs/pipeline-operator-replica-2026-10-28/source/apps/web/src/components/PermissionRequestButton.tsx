import { KeyRound } from "lucide-react";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";

export function PermissionRequestButton({ permission, projectId, label = "申请权限", className }: {
  permission: string; projectId?: string; label?: string; className?: string;
}) {
  const search = new URLSearchParams({ permission });
  if (projectId) search.set("project_id", projectId);
  return <a href={`/access?${search.toString()}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }), className)} data-variant="outline" data-size="sm"><span className="md-button-container md-state-layer"><KeyRound aria-hidden="true" />{label}</span></a>;
}
