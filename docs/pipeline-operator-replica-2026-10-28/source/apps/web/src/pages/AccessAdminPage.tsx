import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, ShieldCheck, UsersRound } from "lucide-react";
import {
  accessDirectoryQueryOptions, adminRequestsQueryOptions, catalogQueryOptions, createAccessGroup,
  missingDependencies, refreshAccess, saveAccessPolicy, saveGroupMembers,
  type AccessDirectory, type AccessGroup, type AccessScope, type PolicyInput,
} from "../access-api";
import { useAuth } from "../auth-context";
import { AccessRequestCard, permissionKindNames } from "../components/AccessRequestCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MaterialTabs } from "../components/ui/tabs";
import { ToolbarSelect } from "../components/ui/period-menu";
import { groupedPermissions } from "./access-permission-groups";
import "./access-pages.css";

function GroupMembers({ group, directory, editable }: { group: AccessGroup; directory: AccessDirectory; editable: boolean }) {
  const { me } = useAuth();
  const client = useQueryClient();
  const [members, setMembers] = useState(group.member_ids);
  const mutation = useMutation({
    mutationFn: () => saveGroupMembers(group.id, members, me.csrf_token),
    onSuccess: () => refreshAccess(client),
  });
  const changed = members.length !== group.member_ids.length || members.some((id) => !group.member_ids.includes(id));
  return <section className="mt-5 access-surface rounded-xl p-5" aria-labelledby="group-members-heading">
    <h2 id="group-members-heading" className="md-title-medium">{group.name}的成员</h2>
    <p className="md-body-small mt-2 text-muted-foreground">成员保存后会立即按组权限重新计算访问权限。</p>
    <div className="mt-4 grid max-h-64 gap-3 overflow-y-auto sm:grid-cols-2">{directory.users.map((user) => <label key={user.id} className="md-selection-control md-body-large flex items-center gap-2"><input type="checkbox" checked={members.includes(user.id)} disabled={!editable || mutation.isPending || user.id === me.actor.id} onChange={(event) => { setMembers((current) => event.target.checked ? [...current, user.id] : current.filter((id) => id !== user.id)); mutation.reset(); }} /><span>{user.display_name}<span className="md-body-small ms-1 text-muted-foreground">{user.username}{!user.is_active ? " · 已停用" : ""}{user.id === me.actor.id ? " · 当前操作者" : ""}</span></span></label>)}</div>
    {editable && <Button className="mt-4" disabled={!changed || mutation.isPending} onClick={() => mutation.mutate()}><Save />{mutation.isPending ? "保存中…" : "保存成员"}</Button>}
    {mutation.isError && <p className="md-body-small mt-3 text-destructive" role="alert">{mutation.error.message}</p>}
    {mutation.isSuccess && <p className="md-body-small mt-3 text-success" role="status">组成员已更新。</p>}
  </section>;
}

function CreateGroup() {
  const groupId = useId();
  const { me } = useAuth();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const mutation = useMutation({
    mutationFn: () => createAccessGroup({ key: key.trim(), name: name.trim() }, me.csrf_token),
    onSuccess: async () => { setName(""); setKey(""); await refreshAccess(client); },
  });
  return <details className="mt-5 access-surface rounded-xl p-5">
    <summary className="access-action-disclosure md-state-layer md-title-medium cursor-pointer">创建用户组</summary>
    <form aria-busy={mutation.isPending} className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); if (name.trim() && key.trim() && !mutation.isPending) mutation.mutate(); }}>
      <label className="block text-sm">组名称<Input aria-label="组名称" disabled={mutation.isPending} className="mt-1" value={name} required maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="例如：视频运营团队" /></label>
      <label className="block text-sm">组标识<Input aria-label="组标识" disabled={mutation.isPending} aria-describedby={`${groupId}-key-help`} className="mt-1" value={key} required maxLength={80} pattern={"[a-zA-Z0-9][a-zA-Z0-9_.\\-]*"} onChange={(event) => setKey(event.target.value)} placeholder="例如：video-operations" /><span id={`${groupId}-key-help`} className="md-body-small mt-1 block text-muted-foreground">以字母或数字开头，可包含短横线、下划线和英文句点。</span></label>
      <Button type="submit" disabled={!name.trim() || !key.trim() || mutation.isPending}><Plus />{mutation.isPending ? "创建中…" : "创建组"}</Button>
      {mutation.isError && <p className="md-body-small text-destructive" role="alert">{mutation.error.message}</p>}
      {mutation.isSuccess && <p className="md-body-small text-success" role="status">用户组已创建，可在上方选择并配置成员与权限。</p>}
    </form>
  </details>;
}

function AccessAdminContent() {
  const { me, can } = useAuth();
  const client = useQueryClient();
  const [scope, setScope] = useState<AccessScope>({ scope_type: "project", scope_id: me.scope.type === "project" ? me.scope.id : "demo" });
  const [subjectType, setSubjectType] = useState<"user" | "group">("user");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const catalog = useQuery(catalogQueryOptions);
  const directory = useQuery(accessDirectoryQueryOptions(scope));
  const canApprove = can("access:approve") && !me.impersonation.active;
  const approvals = useQuery({ ...adminRequestsQueryOptions, enabled: canApprove });
  const policyMutation = useMutation({ mutationFn: (input: PolicyInput) => saveAccessPolicy(input, me.csrf_token), onSuccess: () => refreshAccess(client) });
  const users = directory.data?.users ?? [];
  const groups = directory.data?.groups ?? [];
  const subjectOptions = subjectType === "user" ? users.map((user) => ({ id: user.id, name: user.display_name, detail: user.username })) : groups.map((group) => ({ id: group.id, name: group.name, detail: `${group.member_ids.length} 位成员` }));
  const visibleSubjects = subjectOptions.filter((item) => `${item.name} ${item.detail}`.toLocaleLowerCase("zh-CN").includes(search.trim().toLocaleLowerCase("zh-CN")));
  const selected = subjectOptions.find((item) => item.id === selectedId) ?? subjectOptions[0];
  const selectedUser = subjectType === "user" ? users.find((item) => item.id === selected?.id) : undefined;
  const selectedGroup = subjectType === "group" ? groups.find((item) => item.id === selected?.id) : undefined;
  const protectedSubject = selectedUser?.id === me.actor.id || Boolean(selectedGroup?.member_ids.includes(me.actor.id));
  const canManage = can("access:manage") && !me.impersonation.active;
  const editable = canManage && !protectedSubject;
  const permissions = catalog.data?.permissions ?? [];
  const policies = directory.data?.policies ?? [];
  const pendingCount = approvals.data?.filter((item) => item.status === "pending").length ?? 0;
  const resetSelection = () => { policyMutation.reset(); setSearch(""); };
  return <main className="md-page access-workspace">
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="md-label-large text-muted-foreground">访问控制</p><h1 className="md-page-title mt-1">权限管理</h1><p className="md-body-medium mt-2 text-muted-foreground">按用户或组配置菜单和操作权限，处理成员的权限申请。</p></div>{can("users:read") && <a className="access-action-link md-state-layer text-sm text-primary underline-offset-4 hover:underline" href="/admin/users">管理用户角色</a>}</header>
    <div className="mb-5 flex flex-wrap gap-3"><Badge variant="secondary"><UsersRound className="size-4" />{users.length} 位用户 · {groups.length} 个组</Badge><Badge variant="outline"><ShieldCheck className="size-4" />用户例外优先于组策略</Badge>{canApprove && <Badge variant="outline">{pendingCount} 条待审批</Badge>}</div>
    {me.impersonation.active && <p className="md-body-medium mb-5 rounded-lg bg-muted p-4">当前处于代登录状态，请退出代登录后修改授权或审批。</p>}
    <section className="access-scope-toolbar" aria-label="授权作用域">
      <ToolbarSelect<AccessScope["scope_type"]> label="作用域" prefix="作用域" value={scope.scope_type} options={[{ value: "project", label: "指定项目" }, { value: "global", label: "全局" }]} onChange={(value) => { setScope(value === "global" ? { scope_type: "global", scope_id: "*" } : { scope_type: "project", scope_id: me.scope.type === "project" ? me.scope.id : catalog.data?.projects[0]?.id ?? "demo" }); policyMutation.reset(); }} />
      {scope.scope_type === "project" && <ToolbarSelect label="项目" prefix="项目" value={scope.scope_id} options={catalog.data?.projects.map((project) => ({ value: project.id, label: project.name })) ?? []} onChange={(value) => { setScope({ scope_type: "project", scope_id: value }); policyMutation.reset(); }} />}
      <p className="md-body-small max-w-xl text-muted-foreground">{scope.scope_type === "global" ? "全局策略参与所有项目的权限计算。" : "当前项目策略与全局策略共同生效；同级策略中拒绝优先。"} 选择“继承”会删除当前作用域的直接策略。</p>
    </section>
    {(catalog.isPending || directory.isPending) && <p role="status" className="md-body-medium py-5 text-muted-foreground">正在加载权限配置…</p>}
    {(catalog.isError || directory.isError) && <div role="alert" className="mb-5 rounded-xl border border-destructive p-5"><p className="text-destructive">{catalog.error?.message ?? directory.error?.message}</p><Button variant="outline" className="mt-3" onClick={() => { void catalog.refetch(); void directory.refetch(); }}>重新加载权限配置</Button></div>}
    {catalog.data && directory.data && <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside>
        <section className="access-surface rounded-xl p-4" aria-label="授权对象">
          <MaterialTabs tabs={[{ id: "user", label: "用户" }, { id: "group", label: "用户组" }]} value={subjectType} onChange={(value) => { setSubjectType(value as "user" | "group"); setSelectedId(""); resetSelection(); }}>

          <Input aria-label="搜索授权对象" placeholder="搜索名称" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto">{visibleSubjects.map((item) => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => { setSelectedId(item.id); policyMutation.reset(); }} className={`block w-full rounded-lg px-3 py-3 text-start hover:bg-muted ${selected?.id === item.id ? "bg-secondary" : ""}`}><span className="block text-sm font-medium">{item.name}</span><span className="md-body-small text-muted-foreground">{item.detail}</span></button>)}{visibleSubjects.length === 0 && <div className="py-4"><p className="md-body-small text-muted-foreground">{subjectOptions.length === 0 ? "暂无" : "没有匹配的"}{subjectType === "user" ? "用户" : "用户组"}。</p>{search.trim() && <Button variant="ghost" size="sm" className="mt-1" aria-label="清除授权对象搜索" onClick={() => setSearch("")}>清除搜索</Button>}</div>}</div>
          </MaterialTabs>
        </section>
        {canManage && <CreateGroup />}
      </aside>
      <div>{selected ? <>
        <section className="overflow-hidden access-surface rounded-xl" aria-labelledby="policy-tree-heading">
          <header className="p-5"><h2 id="policy-tree-heading" className="md-title-medium">{selected.name}的权限策略</h2><p className="md-body-small mt-2 text-muted-foreground">修改后自动保存。允许子项不会自动开放上级菜单，需同时授予所需菜单权限。</p>{protectedSubject && <p className="md-body-small mt-2 text-muted-foreground">不能修改自己的授权或自己所在组，需由其他管理员处理。</p>}{!canManage && !me.impersonation.active && <p className="md-body-small mt-2 text-muted-foreground">当前仅可查看权限配置。</p>}{policyMutation.isError && <p role="alert" className="md-body-small mt-2 text-destructive">{policyMutation.error.message}</p>}{policyMutation.isSuccess && <p role="status" className="md-body-small mt-2 text-success">策略已保存，有效权限已更新。</p>}</header>
          <div className="access-permission-toolbar"><span>{permissions.length} 项权限 · 按菜单分组</span><Input aria-label="搜索权限策略" placeholder="搜索权限名称或标识" value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} /></div>
          {groupedPermissions(permissions, permissionSearch).length === 0 && <p className="access-permission-empty">没有匹配的权限。</p>}
          <div>{groupedPermissions(permissions, permissionSearch).map((group) => <details className="access-permission-group" key={group.key} open={Boolean(permissionSearch.trim()) || Boolean(openGroups[group.key])} onToggle={(event) => { const open = event.currentTarget.open; if (!permissionSearch.trim()) setOpenGroups((current) => ({ ...current, [group.key]: open })); }}><summary>{group.name}<span>{group.rows.length} 项权限</span></summary><div>{group.rows.map(({ permission, depth }) => {
            const globalOnly = !permission.requestable && scope.scope_type !== "global";
            const policyScope = globalOnly ? { scope_type: "global", scope_id: "*" } : scope;
            const policy = policies.find((item) => item.subject_type === subjectType && item.subject_id === selected.id && item.permission_key === permission.key && item.scope_type === policyScope.scope_type && item.scope_id === policyScope.scope_id);
            const dependencies = selectedUser ? missingDependencies(permission, permissions, selectedUser.effective_permissions) : [];
            const effective = selectedUser?.effective_permissions.includes(permission.key);
            return <div key={permission.key} className="flex flex-wrap items-center justify-between gap-3 py-3 pe-5" style={{ paddingInlineStart: `${20 + depth * 20}px` }}>
              <div className="min-w-0 flex-1"><span className={`block ${permission.kind === "menu" ? "md-title-small" : "md-body-medium"}`}>{permission.name}</span><p className="md-body-small mt-1 text-muted-foreground">{permissionKindNames[permission.kind]}{selectedUser ? ` · ${effective ? "当前可用" : "当前无权"}` : ""}{globalOnly ? " · 切换全局作用域后配置" : ""}</p>{policy?.effect === "allow" && dependencies.length > 0 && <p className="md-body-small mt-1 text-[var(--md-sys-color-on-warning-container)]">还需上级权限：{dependencies.map((item) => item.name).join("、")}</p>}</div>
              <select aria-label={`${permission.name}的策略`} className="md-compact-select w-28 shrink-0" value={policy?.effect ?? "inherit"} disabled={!editable || globalOnly || policyMutation.isPending} onChange={(event) => policyMutation.mutate({ ...scope, subject_type: subjectType, subject_id: selected.id, permission_key: permission.key, effect: event.target.value as PolicyInput["effect"] })}><option value="inherit">继承</option><option value="allow">允许</option><option value="deny">拒绝</option></select>
            </div>;
          })}</div></details>)}</div>
        </section>
        {selectedUser && <details className="access-effective-permissions mt-5 access-surface rounded-xl p-5"><summary><h2 className="md-title-medium">{scope.scope_type === "global" ? "全局" : "当前项目"}有效权限</h2><span>{selectedUser.effective_permissions.length} 项</span></summary><p className="md-body-small mt-2 text-muted-foreground">已综合个人、用户组、角色和上级菜单权限。</p><div className="mt-3 flex flex-wrap gap-2">{selectedUser.effective_permissions.length ? selectedUser.effective_permissions.map((key) => <Badge key={key} variant="outline">{permissions.find((permission) => permission.key === key)?.name ?? key}</Badge>) : <p className="md-body-small text-muted-foreground">尚无有效业务权限，用户仍可进入权限中心申请。</p>}</div><p className="md-body-small mt-4 text-muted-foreground">所属组：{groups.filter((group) => selectedUser.group_ids.includes(group.id)).map((group) => group.name).join("、") || "暂无"}</p></details>}
        {selectedGroup && <GroupMembers key={`${selectedGroup.id}:${selectedGroup.member_ids.join(",")}`} group={selectedGroup} directory={directory.data} editable={editable} />}
      </> : <p className="md-body-medium rounded-xl bg-muted p-6 text-muted-foreground">选择用户或用户组后配置权限。</p>}</div>
    </div>}
    {canApprove && <section className="mt-9" aria-labelledby="approval-list-heading"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="approval-list-heading" className="md-title-large">权限申请审批</h2><ToolbarSelect label="审批状态筛选" value={status} onChange={setStatus} options={[{value:"pending",label:"待审批"},{value:"all",label:"全部申请"}]} /></div>
      {approvals.isPending && <p role="status" className="md-body-medium text-muted-foreground">正在加载申请…</p>}
      {approvals.isError && <div role="alert"><p className="text-destructive">{approvals.error.message}</p><Button className="mt-3" variant="outline" onClick={() => void approvals.refetch()}>重新加载申请</Button></div>}
      {approvals.data?.filter((item) => status === "all" || item.status === "pending").length === 0 && <p className="md-body-medium rounded-xl bg-muted p-6 text-muted-foreground">{status === "pending" ? "暂无待审批申请。" : "暂无权限申请。"}</p>}
      <div className="grid gap-4 xl:grid-cols-2">{approvals.data?.filter((item) => status === "all" || item.status === "pending").map((request) => <AccessRequestCard key={request.id} request={request} catalog={catalog.data} allowReview />)}</div>
    </section>}
  </main>;
}

export default function AccessAdminPage() {
  const { can } = useAuth();
  if (!can("access:read")) return <main className="md-page access-workspace"><h1 className="md-page-title">权限管理</h1><p className="md-body-medium mt-3 text-muted-foreground" role="alert">当前身份没有查看权限配置的授权，请联系管理员。</p></main>;
  return <AccessAdminContent />;
}
