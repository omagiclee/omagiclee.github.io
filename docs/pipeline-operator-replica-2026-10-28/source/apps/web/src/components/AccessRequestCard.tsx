import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { decidePermissionRequest, refreshAccess, type PermissionCatalog, type PermissionRequest } from "../access-api";
import { useAuth } from "../auth-context";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export const requestStatusNames = { pending: "待审批", approved: "已通过", rejected: "已拒绝" };
export const permissionKindNames = { menu: "一级菜单", page: "二级菜单", button: "页面操作" };
export function accessTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function AccessRequestCard({ request, catalog, allowReview = false }: {
  request: PermissionRequest; catalog?: PermissionCatalog; allowReview?: boolean;
}) {
  const { me, can } = useAuth();
  const client = useQueryClient();
  const [comment, setComment] = useState("");
  const mutation = useMutation({
    mutationFn: (decision: "approved" | "rejected") => decidePermissionRequest(request.id, decision, comment.trim(), me.csrf_token),
    onSuccess: () => refreshAccess(client),
    onError: () => { void client.invalidateQueries({ queryKey: ["access", "requests"] }); },
  });
  const self = request.requester_id === me.actor.id;
  const reviewable = allowReview && can("access:approve") && request.status === "pending" && !self && !me.impersonation.active;
  return <article className="rounded-xl bg-card p-5" aria-label={`${request.permission_name}的权限申请`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="md-title-medium">{request.permission_name}</h3>
      <Badge variant={request.status === "pending" ? "secondary" : "outline"}>{requestStatusNames[request.status]}</Badge>
    </div>
    <p className="md-body-small mt-2 break-words text-muted-foreground" style={{ overflowWrap: "anywhere" }}>{request.requester_name} · {catalog?.projects.find((item) => item.id === request.project_id)?.name ?? request.project_id} · {accessTime(request.created_at)}</p>
    <p className="md-body-medium mt-3 whitespace-pre-wrap break-words">{request.reason}</p>
    <div className="mt-3 rounded-lg bg-muted p-3">
      <p className="md-label-medium">本次申请授权范围</p>
      <div className="mt-2 flex flex-wrap gap-2">{request.requested_permissions.map((key) => <Badge key={key} variant="outline">{catalog?.permissions.find((item) => item.key === key)?.name ?? (key === request.permission_key ? request.permission_name : "上级菜单权限")}</Badge>)}</div>
      {request.requested_permissions.length > 1 && <p className="md-body-small mt-2 text-muted-foreground">包含访问该功能所需、申请时尚未拥有的上级菜单权限。</p>}
    </div>
    {request.reviewed_at && <p className="md-body-small mt-3 text-muted-foreground">{request.reviewer_name ?? "管理员"} 于 {accessTime(request.reviewed_at)}处理{request.review_comment ? `：${request.review_comment}` : ""}</p>}
    {allowReview && request.status === "pending" && self && <p className="md-body-small mt-3 text-muted-foreground">自己的申请需要其他管理员审批。</p>}
    {allowReview && request.status === "pending" && me.impersonation.active && <p className="md-body-small mt-3 text-muted-foreground">请退出代登录后审批。</p>}
    {reviewable && <div className="mt-4 space-y-3 pt-4">
      <label className="md-body-small block">审批说明（选填）<textarea className="mt-2 block min-h-20 w-full rounded-lg border border-border bg-background p-3 text-sm" aria-label={`审批说明：${request.permission_name}`} maxLength={2000} disabled={mutation.isPending} value={comment} onChange={(event) => setComment(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button disabled={mutation.isPending} onClick={() => mutation.mutate("approved")}><Check />{mutation.isPending && mutation.variables === "approved" ? "通过中…" : "确认通过"}</Button><Button variant="destructive-text" disabled={mutation.isPending} onClick={() => mutation.mutate("rejected")}><X />{mutation.isPending && mutation.variables === "rejected" ? "处理中…" : "拒绝申请"}</Button></div>
    </div>}
    {mutation.isError && <p className="md-body-small mt-3 text-destructive" role="alert">{mutation.error.message}</p>}
    {mutation.isSuccess && <p className="md-body-small mt-3 text-success" role="status">审批已完成，结果已通知申请人。</p>}
  </article>;
}
