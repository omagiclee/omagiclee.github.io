import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Check, KeyRound, Send } from "lucide-react";
import {
  catalogQueryOptions, createPermissionRequest, missingDependencies, ownRequestsQueryOptions,
  refreshAccess,
} from "../access-api";
import { useAuth, useProjectAuth } from "../auth-context";
import { AccessRequestCard, permissionKindNames } from "../components/AccessRequestCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { groupedPermissions } from "./access-permission-groups";
import "./access-pages.css";

export default function AccessPage() {
  const session = useAuth();
  const client = useQueryClient();
  const catalog = useQuery(catalogQueryOptions);
  const history = useQuery(ownRequestsQueryOptions);
  const search = useSearch({ from: "/access" });
  const [selectedKey, setSelectedKey] = useState(() => search.permission ?? "");
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const mutation = useMutation({
    mutationFn: () => createPermissionRequest({ permission_key: selectedKey, project_id: projectId, reason: reason.trim() }, me.csrf_token),
    onSuccess: async () => { setReason(""); await refreshAccess(client); },
  });
  const permissions = catalog.data?.permissions ?? [];
  const selected = permissions.find((item) => item.key === selectedKey);
  const defaultProject = catalog.data?.projects.find((project) => project.id === (session.me.scope.type === "project" ? session.me.scope.id : ""))?.id ?? catalog.data?.projects[0]?.id;
  const projectId = search.project_id ?? defaultProject ?? "";
  const { me, can } = useProjectAuth(projectId || undefined);
  const projectExists = catalog.data?.projects.some((item) => item.id === projectId);
  const projectName = catalog.data?.projects.find((item) => item.id === projectId)?.name ?? projectId;
  const missing = selected ? missingDependencies(selected, permissions, me.permissions) : [];
  const owned = selected ? can(selected.key) : false;
  const pending = history.data?.some((item) => item.permission_key === selectedKey && item.project_id === projectId && item.status === "pending");
  const groups = groupedPermissions(permissions, query);
  const select = (key: string) => { setSelectedKey(key); setReason(""); mutation.reset(); };
  return <main className="md-page access-workspace">
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="md-label-large text-muted-foreground">账号</p><h1 className="md-page-title mt-1">我的权限</h1><p className="md-body-medium mt-2 text-muted-foreground">查看当前项目的访问权限，提交权限申请并跟踪审批结果。</p></div><Badge variant="secondary"><KeyRound className="size-4" />{projectName || "当前项目"}</Badge></header>
    {catalog.isPending && <p role="status" className="md-body-medium py-8 text-muted-foreground">正在加载权限目录…</p>}
    {catalog.isError && <div role="alert" className="rounded-xl border border-destructive p-5"><p>{catalog.error.message}</p><Button variant="outline" className="mt-3" onClick={() => void catalog.refetch()}>重新加载</Button></div>}
    {catalog.data && !projectExists && <p className="text-destructive" role="alert">目标项目不存在，请从主导航中的项目选择入口切换项目，或重新打开有效的项目链接。</p>}
    {catalog.data && projectExists && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="access-surface rounded-xl" aria-labelledby="permission-tree-heading">
        <div className="p-5"><h2 id="permission-tree-heading" className="md-title-medium">菜单与页面操作</h2><Input className="mt-3" placeholder="搜索权限名称" aria-label="搜索权限名称" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div>
          {groups.length === 0 && <p className="md-body-medium p-5 text-muted-foreground">没有匹配的权限。</p>}
          {groups.map((group) => <details className="access-permission-group" key={group.key} open={Boolean(query.trim()) || (openGroups[group.key] ?? group.rows.some(({ permission }) => permission.key === selectedKey))} onToggle={(event) => { const open = event.currentTarget.open; if (!query.trim()) setOpenGroups((current) => ({ ...current, [group.key]: open })); }}><summary>{group.name}<span>{group.rows.length} 项权限</span></summary><div>{group.rows.map(({ permission, depth }) => <button type="button" key={permission.key} onClick={() => select(permission.key)} aria-pressed={selectedKey === permission.key} className={`flex w-full items-center justify-between gap-3 rounded-lg py-3 pe-3 text-start transition-colors hover:bg-muted ${selectedKey === permission.key ? "bg-secondary text-secondary-foreground" : ""}`} style={{ paddingInlineStart: `${12 + depth * 20}px` }}>
            <span className="min-w-0"><span className={`block ${permission.kind === "menu" ? "md-title-small" : "md-body-medium"}`}>{permission.name}</span><span className="md-body-small text-muted-foreground">{permissionKindNames[permission.kind]}</span></span>
            <span className={`shrink-0 text-xs ${can(permission.key) ? "text-success" : "text-muted-foreground"}`}>{can(permission.key) ? <span className="flex items-center gap-1"><Check className="size-3" />已拥有</span> : permission.requestable ? "可申请" : "管理员配置"}</span>
          </button>)}</div></details>)}
        </div>
      </section>
      <section className="access-surface rounded-xl p-5" aria-labelledby="request-form-heading">
        <h2 id="request-form-heading" className="md-title-medium">申请权限</h2>
        {!selected && <p className="md-body-medium mt-3 text-muted-foreground">{selectedKey ? "未找到该权限，请从目录中重新选择。" : "从左侧选择需要的菜单或页面操作。"}</p>}
        {selected && <>
          <div className="mt-4 flex flex-wrap items-center gap-2"><strong className="md-title-small">{selected.name}</strong><Badge variant="outline">{permissionKindNames[selected.kind]}</Badge></div>
          {owned ? <p className="md-body-medium mt-4 text-success" role="status">你已拥有此权限，可以直接使用。</p>
            : !selected.requestable ? <p className="md-body-medium mt-4 text-muted-foreground">此项属于管理权限，请联系管理员配置。</p>
            : me.impersonation.active ? <p className="md-body-medium mt-4 text-muted-foreground">请退出代登录后，以本人身份提交权限申请。</p>
            : pending ? <p className="md-body-medium mt-4 text-muted-foreground" role="status">此权限已有待审批申请，请等待管理员处理。</p>
            : <form aria-busy={mutation.isPending} className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); if (reason.trim() && projectId && !history.isError && !history.isPending && !mutation.isPending) mutation.mutate(); }}>
              <div className="rounded-lg bg-muted p-3"><p className="md-label-medium">申请项目：{projectName}</p><p className="md-body-small mt-2 text-muted-foreground">{missing.length ? "通过后将一并授予以下缺失的上级权限：" : "已满足上级菜单权限，只申请当前权限。"}</p>{missing.length > 0 && <ul className="md-body-small mt-2 list-inside list-disc space-y-1">{missing.map((item) => <li key={item.key}>{item.name}</li>)}</ul>}</div>
              <label className="md-body-medium block">申请理由<textarea className="mt-2 block min-h-32 w-full rounded-lg border border-border bg-background p-3 text-sm" aria-label="申请理由" disabled={mutation.isPending} placeholder="说明要完成的工作，以及为什么需要此权限" maxLength={2000} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              <Button type="submit" className="w-full" disabled={!reason.trim() || !projectId || history.isPending || history.isError || mutation.isPending}><Send />{mutation.isPending ? "提交中…" : "提交申请"}</Button>
            </form>}
        </>}
        {mutation.isError && <p className="md-body-small mt-4 text-destructive" role="alert">{mutation.error.message}</p>}
        {mutation.isSuccess && <p className="md-body-small mt-4 text-success" role="status">申请已提交，管理员已收到审批站内信。</p>}
      </section>
    </div>}
    <section className="mt-8" aria-labelledby="my-requests-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="my-requests-heading" className="md-title-large">我的申请记录</h2><a className="access-action-link md-state-layer text-sm text-primary underline-offset-4 hover:underline" href="/notifications">查看站内信</a></div>
      {history.isPending && <p className="md-body-medium text-muted-foreground" role="status">正在加载申请记录…</p>}
      {history.isError && <div role="alert"><p className="text-destructive">{history.error.message}</p><Button variant="outline" className="mt-2" onClick={() => void history.refetch()}>重试申请记录</Button></div>}
      {history.data?.length === 0 && <p className="md-body-medium rounded-xl bg-muted p-6 text-muted-foreground">还没有权限申请，选择需要的权限即可发起。</p>}
      <div className="grid gap-4 lg:grid-cols-2">{history.data?.map((request) => <AccessRequestCard key={request.id} request={request} catalog={catalog.data} />)}</div>
    </section>
  </main>;
}
