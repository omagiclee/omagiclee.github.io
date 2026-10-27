import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { adminRequestsQueryOptions, catalogQueryOptions, markNotificationRead, notificationsQueryOptions, ownRequestsQueryOptions } from "../access-api";
import { useAuth } from "../auth-context";
import { AccessRequestCard, accessTime } from "../components/AccessRequestCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import "./notifications.css";

export default function NotificationsPage() {
  const { me, can } = useAuth();
  const client = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const notifications = useQuery(notificationsQueryOptions);
  const catalog = useQuery(catalogQueryOptions);
  const canApprove = can("access:approve") && !me.impersonation.active;
  const adminRequests = useQuery({ ...adminRequestsQueryOptions, enabled: canApprove && expanded !== null });
  const ownRequests = useQuery({ ...ownRequestsQueryOptions, enabled: expanded !== null });
  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id, me.csrf_token),
    onSuccess: () => client.invalidateQueries({ queryKey: notificationsQueryOptions.queryKey }),
  });
  return <main className="md-page notifications-workspace">
    <header className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="md-label-large text-muted-foreground">账号</p><h1 className="md-page-title mt-1">通知中心</h1><p className="md-body-medium mt-2 text-muted-foreground">查看权限申请与审批结果，处理待办事项。</p></div><Badge variant="secondary"><Bell className="size-4" />{notifications.data ? `${notifications.data.unread_count} 条未读` : "站内通知"}</Badge></header>
    {notifications.isPending && <p role="status" className="md-body-medium py-8 text-muted-foreground">正在加载站内信…</p>}
    {notifications.isError && <div role="alert"><p className="text-destructive">{notifications.error.message}</p><Button className="mt-3" variant="outline" onClick={() => void notifications.refetch()}>重新加载</Button></div>}
    {markRead.isError && <p role="alert" className="mb-4 text-destructive">{markRead.error.message}</p>}
    {notifications.data?.items.length === 0 && <div className="rounded-xl bg-[var(--md-sys-color-surface-container-low)] p-12 text-center"><Bell className="mx-auto size-9 text-muted-foreground" /><h2 className="md-title-medium mt-4">暂无站内信</h2><p className="md-body-medium mt-2 text-muted-foreground">收到权限申请或审批结果时，会在这里通知你。</p></div>}
    <div className="space-y-3">{notifications.data?.items.map((notification) => {
      const open = expanded === notification.id;
      const detailsId = `notification-details-${notification.id}`;
      const request = [...(adminRequests.data ?? []), ...(ownRequests.data ?? [])].find((item) => item.id === notification.request_id);
      const detailsLoading = ownRequests.isPending || (canApprove && adminRequests.isPending);
      const detailsError = ownRequests.error ?? (canApprove ? adminRequests.error : null);
      return <section key={notification.id} className={`rounded-xl p-4 ${notification.read_at ? "bg-card" : "bg-secondary"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2">{!notification.read_at && <span className="size-2 shrink-0 rounded-full bg-primary" role="img" aria-label="未读" />}<h2 className="md-title-medium min-w-0">{notification.title}</h2></div><p className="md-body-small mt-1 text-muted-foreground">{accessTime(notification.created_at)}</p></div>{!notification.read_at && <Button variant="ghost" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(notification.id)}><CheckCheck />标记已读</Button>}</div>
        <p className="md-body-medium mt-3 whitespace-pre-wrap break-words">{notification.body}</p>
        {notification.request_id && <Button className="mt-4" variant="outline" size="sm" aria-expanded={open} aria-controls={detailsId} onClick={() => { setExpanded(open ? null : notification.id); if (!notification.read_at && !markRead.isPending) markRead.mutate(notification.id); }}>{open ? "收起申请详情" : "查看申请详情"}</Button>}
        {notification.request_id && <div id={detailsId} hidden={!open} className="mt-4">{open && <>
          {request ? <AccessRequestCard request={request} catalog={catalog.data} allowReview={canApprove} /> : detailsLoading ? <p role="status" className="md-body-medium text-muted-foreground">正在加载申请详情…</p> : detailsError ? <div role="alert"><p className="text-destructive">{detailsError.message}</p><Button className="mt-2" variant="outline" onClick={() => { void ownRequests.refetch(); if (canApprove) void adminRequests.refetch(); }}>重试申请详情</Button></div> : <p className="md-body-medium rounded-lg bg-muted p-4 text-muted-foreground">该申请已不可查看，或当前身份已没有审批权限。消息内容仍保留供参考。</p>}
        </>}</div>}
      </section>;
    })}</div>
  </main>;
}
