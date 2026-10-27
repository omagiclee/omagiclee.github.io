import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { notificationsQueryOptions } from "../access-api";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";

export function NotificationBell() {
  const query = useQuery(notificationsQueryOptions);
  const count = query.data?.unread_count ?? 0;
  return <a href="/notifications" className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "app-notification-trigger relative")} aria-label={query.isError ? "站内信，暂时无法获取未读数" : count ? `站内信，${count} 条未读` : "站内信"} title={query.isError ? "未读数加载失败，点击查看站内信" : "站内信"} data-variant="ghost" data-size="icon"><span className="md-button-container md-state-layer">
    <Bell aria-hidden="true" />
    {count > 0 && <span className="app-notification-badge" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    {query.isError && <span className="app-notification-badge app-notification-badge-dot" aria-hidden="true" />}
  </span></a>;
}
