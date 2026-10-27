import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Plus, Save, Search, ShieldCheck, Trash2, UsersRound } from "lucide-react";
import {
  updateUserRoleBindings,
  userDirectoryQueryOptions,
  type AdminUser,
  type RoleBindingInput,
  type UserDirectory,
} from "../admin-api";
import { useAuth } from "../auth-context";
import { gridTheme, gridLocaleZhCN } from "../components/ui/grid-theme";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { interactionForEvent, type InteractionContext } from "../telemetry";
import { catalogQueryOptions, type PermissionDefinition } from "../access-api";
import "./users-admin.css";

ModuleRegistry.registerModules([AllCommunityModule]);

interface BindingDraft extends RoleBindingInput {
  draftId: string;
}



function directDrafts(user: AdminUser): BindingDraft[] {
  return user.bindings.filter((binding) => !binding.inherited).map((binding) => ({
    draftId: binding.id,
    role_key: binding.role_key,
    scope_type: binding.scope_type,
    scope_id: binding.scope_id,
  }));
}

function sameBindings(left: BindingDraft[], right: BindingDraft[]) {
  const identities = (bindings: BindingDraft[]) => bindings.map(({ role_key, scope_type, scope_id }) => `${role_key}:${scope_type}:${scope_type === "global" ? "*" : scope_id}`).sort();
  return JSON.stringify(identities(left)) === JSON.stringify(identities(right));
}

function PermissionEditor({ user, directory, savedDrafts, onDraftChange, onDraftSaved }: {
  user: AdminUser; directory: UserDirectory; savedDrafts?: BindingDraft[];
  onDraftChange: (drafts: BindingDraft[]) => void; onDraftSaved: (userId: string) => void;
}) {
  const catalog = useQuery(catalogQueryOptions);
  const permissionByKey = useMemo(() => new Map(catalog.data?.permissions.map((permission) => [permission.key, permission]) ?? []), [catalog.data]);
  const permissionGroups: { kind: PermissionDefinition["kind"] | "other"; label: string }[] = [{ kind: "menu", label: "菜单访问" }, { kind: "page", label: "页面查看" }, { kind: "button", label: "业务操作" }, { kind: "other", label: "其他权限" }];
  const { me, can } = useAuth();
  const queryClient = useQueryClient();
  const drafts = savedDrafts ?? directDrafts(user);
  const dirty = !sameBindings(drafts, directDrafts(user));
  const setDrafts = (update: BindingDraft[] | ((current: BindingDraft[]) => BindingDraft[])) => onDraftChange(typeof update === "function" ? update(drafts) : update);

  const mutation = useMutation({
    mutationFn: (interaction?: InteractionContext) => updateUserRoleBindings(
      user.id,
      drafts.map(({ role_key, scope_type, scope_id }) => ({ role_key, scope_type, scope_id })),
      me.csrf_token,
      interaction,
    ),
    onSuccess: (updated) => {
      queryClient.setQueryData<UserDirectory>(userDirectoryQueryOptions.queryKey, (current) => current ? {
        ...current,
        users: current.users.map((item) => item.id === updated.id ? updated : item),
      } : current);
      onDraftSaved(user.id);
    },
  });

  const inherited = user.bindings.filter((binding) => binding.inherited);
  const self = user.id === me.actor.id;
  const editable = can("users:manage") && !self && !me.impersonation.active;
  const identities = drafts.map((item) => `${item.role_key}:${item.scope_type}:${item.scope_type === "global" ? "*" : item.scope_id}`);
  const hasDuplicates = new Set(identities).size !== identities.length;
  const invalid = drafts.some((item) => !item.role_key || (item.scope_type === "project" && !item.scope_id));

  const addBinding = () => {
    const firstRole = directory.roles[0];
    const firstProject = directory.projects[0];
    if (!firstRole || !firstProject) return;
    setDrafts((current) => [...current, {
      draftId: `new-${Date.now()}`,
      role_key: firstRole.key,
      scope_type: "project",
      scope_id: firstProject.id,
    }]);
    mutation.reset();
  };

  const patchDraft = (draftId: string, patch: Partial<BindingDraft>) => {
    setDrafts((current) => current.map((item) => item.draftId === draftId ? { ...item, ...patch } : item));
    mutation.reset();
  };

  return (
    <section className="users-permission-editor" aria-labelledby="permission-editor-heading">
      <header className="users-editor-header">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground">{user.display_name.slice(0, 1)}</span>
          <div className="min-w-0">
            <h2 id="permission-editor-heading" className="md-title-medium break-words [overflow-wrap:anywhere]">{user.display_name}</h2>
            <p className="md-body-small break-words [overflow-wrap:anywhere] text-muted-foreground">{user.username} · {user.email ?? "未设置邮箱"}</p>
            {can("audit:read") && <a data-track-id="users.view_activity" data-track-label="查看用户操作记录" className="access-action-link md-state-layer mt-2 text-sm text-primary underline underline-offset-4" href={`/admin/audit?days=30&project_id=*&user_id=${encodeURIComponent(user.id)}`}>查看此用户的操作记录</a>}
          </div>
        </div>
      </header>

      <div className="users-editor-body">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="md-title-small">直接角色</h3>
              <p className="md-body-small mt-1 text-muted-foreground">角色与作用域共同决定权限</p>
            </div>
            {editable && <Button data-track-id="users.add_role" data-track-label="添加用户角色" variant="outline" size="sm" disabled={mutation.isPending} onClick={addBinding}><Plus />添加</Button>}
          </div>

          {editable && drafts.length === 0 && <p className="md-body-medium rounded-lg bg-muted px-3 py-4 text-muted-foreground">尚未直接授予角色。</p>}
          {editable ? <div className="space-y-3">
            {drafts.map((binding) => {
              const role = directory.roles.find((item) => item.key === binding.role_key);
              return (
                <div className="space-y-2 py-3 first:pt-0" key={binding.draftId}>
                  <div className="users-binding-controls">
                    <select className="md-compact-select" aria-label="角色" value={binding.role_key} disabled={!editable || mutation.isPending} onChange={(event) => patchDraft(binding.draftId, { role_key: event.target.value })}>
                      {!role && <option value={binding.role_key}>{binding.role_key}（未登记角色）</option>}{directory.roles.map((item) => <option value={item.key} key={item.key}>{item.name}</option>)}
                    </select>
                    <select className="md-compact-select" aria-label="作用域类型" value={binding.scope_type} disabled={!editable || mutation.isPending} onChange={(event) => patchDraft(binding.draftId, {
                      scope_type: event.target.value as "global" | "project",
                      scope_id: event.target.value === "global" ? "*" : directory.projects[0]?.id ?? "",
                    })}>
                      <option value="project">项目</option>
                      <option value="global">全局</option>
                    </select>
                    {editable ? <Button data-track-id="users.remove_role" data-track-label="移除用户角色" variant="destructive-text" size="icon" title="移除角色" aria-label="移除角色" disabled={!editable || mutation.isPending} onClick={() => {
                      setDrafts((current) => current.filter((item) => item.draftId !== binding.draftId));
                      mutation.reset();
                    }}><Trash2 /></Button> : <span aria-hidden="true" />}
                  </div>
                  {binding.scope_type === "project" && (
                    <select className="md-compact-select w-full" aria-label="项目作用域" value={binding.scope_id} disabled={!editable || mutation.isPending} onChange={(event) => patchDraft(binding.draftId, { scope_id: event.target.value })}>
                      {!directory.projects.some((project) => project.id === binding.scope_id) && <option value={binding.scope_id}>{binding.scope_id}（未登记项目）</option>}{directory.projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
                    </select>
                  )}
                  <p className="md-body-small text-muted-foreground">{role?.description}</p>
                </div>
              );
            })}
          </div> : <div className="users-role-summary">{directDrafts(user).length > 0 ? directDrafts(user).map((binding) => <div key={binding.draftId}><strong>{directory.roles.find((role) => role.key === binding.role_key)?.name ?? binding.role_key}</strong><span>{binding.scope_type === "global" ? "全局" : directory.projects.find((project) => project.id === binding.scope_id)?.name ?? binding.scope_id}</span></div>) : <p>尚未直接授予角色。</p>}</div>}
          {dirty && <div className="users-draft-notice" role="status"><span>有未保存的角色变更，切换用户后仍会保留。</span><Button variant="ghost" size="sm" disabled={mutation.isPending} onClick={() => { onDraftSaved(user.id); mutation.reset(); }}>重置变更</Button></div>}
          {self && <p className="md-body-small mt-3 text-muted-foreground">为避免锁死管理入口，不能修改自己的角色。</p>}
          {me.impersonation.active && <p className="md-body-small mt-3 text-muted-foreground">代登录期间不能修改用户角色，请退出代登录后操作。</p>}
          {hasDuplicates && <p className="md-body-small mt-3 text-destructive" role="alert">存在重复的角色与作用域组合。</p>}
          {mutation.isError && <p className="md-body-small mt-3 text-destructive" role="alert">{mutation.error.message}</p>}
          {mutation.isSuccess && <p className="md-body-small mt-3 text-success" role="status">权限已保存并写入审计记录。</p>}
          {editable && (
            <Button data-track-id="users.save_roles" data-track-label="保存用户权限" className="mt-4 w-full" disabled={invalid || hasDuplicates || mutation.isPending} onClick={(event) => mutation.mutate(interactionForEvent(event.nativeEvent))}>
              <Save />{mutation.isPending ? "保存中" : "保存权限"}
            </Button>
          )}
        </section>

        <section>
          <h3 className="md-title-small">组继承</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {inherited.length
              ? inherited.map((binding) => <Badge variant="secondary" key={binding.id}>{binding.source_name} · {binding.role_name}</Badge>)
              : <span className="md-body-small text-muted-foreground">没有通过组继承的角色</span>}
          </div>
        </section>

        <section>
          <div className="users-permission-heading"><h3 className="md-title-small">当前项目有效权限</h3><span>{user.effective_permissions.length} 项</span></div>
          {catalog.isPending && <p className="md-body-small mt-2 text-muted-foreground">正在加载权限名称…</p>}
          {catalog.isError && <p className="md-body-small mt-2 text-muted-foreground" role="status">权限名称暂不可用，可展开查看全部权限标识。</p>}
          {!user.effective_permissions.length && <p className="md-body-small mt-2 text-muted-foreground">当前项目未授予权限。</p>}
          <div className="users-permission-groups">
            {permissionGroups.map(({ kind, label }) => {
              const permissions = user.effective_permissions.filter((key) => (permissionByKey.get(key)?.kind ?? "other") === kind);
              return permissions.length > 0 && <details className="users-permission-group" key={kind}><summary>{label}<span>{permissions.length} 项</span></summary><div>{permissions.map((key) => <Badge variant="outline" key={key}>{permissionByKey.get(key)?.name ?? key}</Badge>)}</div></details>;
            })}
          </div>
          {user.effective_permissions.length > 0 && <details className="users-permission-identifiers"><summary>查看全部权限标识</summary><dl>{user.effective_permissions.map((key) => <div key={key}><dt>{permissionByKey.get(key)?.name ?? "未登记权限"}</dt><dd><code>{key}</code></dd></div>)}</dl></details>}

        </section>
      </div>
    </section>
  );
}

function UsersAdminContent() {
  const { me } = useAuth();
  const { data: directory } = useSuspenseQuery(userDirectoryQueryOptions);
  const [query, setQuery] = useState("");
  const [draftsByUser, setDraftsByUser] = useState<Record<string, BindingDraft[]>>({});
  const [compact, setCompact] = useState(() => typeof window.matchMedia === "function" && window.matchMedia("(max-width:640px)").matches);
  const [tableOpen, setTableOpen] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width:640px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const clearDrafts = (userId: string) => setDraftsByUser((current) => {
    const next = { ...current }; delete next[userId]; return next;
  });
  const [selectedId, setSelectedId] = useState(() => directory.users[0]?.id ?? "");
  const users = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    if (!needle) return directory.users;
    return directory.users.filter((user) => [user.display_name, user.username, user.email ?? "", ...user.groups, ...user.effective_roles, ...user.effective_roles.map((key) => directory.roles.find((role) => role.key === key)?.name ?? key)]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(needle)));
  }, [directory.users, directory.roles, query]);
  const selected = directory.users.find((user) => user.id === selectedId) ?? directory.users[0];

  const columns = useMemo<ColDef<AdminUser>[]>(() => [
    { field: "display_name", headerName: "用户", minWidth: 130, flex: 1, cellRenderer: ({ data, value }: { data?: AdminUser; value: string }) => <button className="users-user-link" onClick={() => data && setSelectedId(data.id)} aria-label={`查看 ${value} 的权限`}>{value}</button> },
    { field: "username", headerName: "用户名", minWidth: 128, flex: 1, tooltipField: "username" },
    { field: "groups", headerName: "用户组", minWidth: 136, flex: 1, valueFormatter: ({ value }) => (value as string[]).join("、") || "-" },
    { field: "effective_roles", headerName: "有效角色", minWidth: 160, flex: 1.2, valueFormatter: ({ value }) => (value as string[]).map((key) => directory.roles.find((role) => role.key === key)?.name ?? key).join("、") || "—" },
    { field: "is_active", headerName: "状态", width: 88, cellDataType: false, valueFormatter: ({ value }) => value ? "启用" : "停用" },
  ], [directory.roles]);

  return (
    <main className="md-page users-admin-workspace">
      <header className="users-page-header">
        <div><h1 className="md-page-title">用户与权限</h1><p>管理用户角色与作用域，检查项目访问权限。</p></div>
        <span className="users-actor">当前操作者：{me.actor.display_name}</span>
      </header>
      <section className="users-summary" aria-label="权限概览">
        <span><UsersRound aria-hidden="true" />平台用户<strong>{directory.users.length}</strong></span>
        <span>已启用<strong>{directory.users.filter((user) => user.is_active).length}</strong></span>
        <span><ShieldCheck aria-hidden="true" />业务角色<strong>{directory.roles.length}</strong></span>
      </section>
      <div className="users-directory-layout">
        <section className="users-directory" aria-labelledby="user-directory-heading">
          <div className="users-directory-toolbar">
            <div><h2 id="user-directory-heading">用户目录</h2><span>{users.length} 位用户</span></div>
            <label className="md-search"><Search aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户、组或角色" aria-label="搜索用户" /></label>
          </div>
          {selected && <label className="users-mobile-picker"><span>查看用户</span><select className="md-compact-select" aria-label="选择用户" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{!users.some((user) => user.id === selected.id) && <option value={selected.id}>{selected.display_name}（当前查看）</option>}{users.map((user) => <option key={user.id} value={user.id}>{user.display_name} · {user.username}</option>)}</select></label>}
          {selected && !users.some((user) => user.id === selected.id) && <p className="users-directory-hint">当前查看的用户不在筛选结果中。选择目录中的用户可切换详情。</p>}
          {users.length > 0 ? <details className="users-table-disclosure" open={!compact || tableOpen} onToggle={(event) => { if (compact) setTableOpen(event.currentTarget.open); }}>
            <summary>完整用户表格<span>{users.length} 位用户</span></summary>
            <p className="users-directory-hint users-directory-help">选择用户查看权限；在窄屏上可左右滑动查看完整列。</p>
            <div className="md-grid-shell users-grid">

            <AgGridReact<AdminUser>
              theme={gridTheme}
              localeText={gridLocaleZhCN}
              domLayout="autoHeight"
              rowData={users}
              columnDefs={columns}
              defaultColDef={{ sortable: true, resizable: true, filter: true, autoHeight: true, wrapText: true, autoHeaderHeight: true, wrapHeaderText: true }}
              getRowId={({ data }) => data.id}
              onRowClicked={({ data }) => data && setSelectedId(data.id)}
              onCellKeyDown={({ data, event }) => data && (event as KeyboardEvent)?.key === "Enter" && setSelectedId(data.id)}
              rowClassRules={{ "admin-row-selected": ({ data }) => data?.id === selected?.id }}
              headerHeight={40}
              rowHeight={48}
              pagination={users.length > 10}
              paginationPageSize={10}
              paginationPageSizeSelector={[10, 20, 50]}
            />
            </div>
          </details> : <div className="users-search-empty"><h3>{directory.users.length ? "没有匹配的用户" : "暂无用户"}</h3><p>{directory.users.length ? "尝试其他名称、用户名、组或角色。" : "用户加入平台后，可在此配置角色与作用域。"}</p>{query && <Button variant="outline" onClick={() => setQuery("")}>清除搜索</Button>}</div>}
        </section>
        {selected ? <PermissionEditor key={selected.id} user={selected} directory={directory} savedDrafts={draftsByUser[selected.id]} onDraftChange={(drafts) => {
          if (sameBindings(drafts, directDrafts(selected))) clearDrafts(selected.id);
          else setDraftsByUser((current) => ({ ...current, [selected.id]: drafts }));
        }} onDraftSaved={clearDrafts} /> : <section className="users-no-selection"><UsersRound aria-hidden="true" /><h2>{directory.users.length ? "没有匹配的用户" : "暂无用户"}</h2><p>{directory.users.length ? "尝试其他名称、用户名、组或角色。" : "用户加入平台后，可在此配置角色与作用域。"}</p>{query && <Button variant="outline" onClick={() => setQuery("")}>清除搜索</Button>}</section>}
      </div>
    </main>
  );
}

export default function UsersAdminPage() {
  const { can } = useAuth();
  if (!can("users:read")) {
    return <main className="md-page"><h1 className="md-page-title">无权访问</h1><p className="md-body-medium mt-2 text-muted-foreground">当前身份没有管理用户权限的授权。</p></main>;
  }
  return <UsersAdminContent />;
}
