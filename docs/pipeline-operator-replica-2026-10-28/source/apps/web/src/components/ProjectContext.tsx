import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, FolderKanban } from "lucide-react";
import type { ReactNode } from "react";
import { accessibleProjectsQueryOptions, type AccessibleProject } from "../auth-api";
import { catalogQueryOptions } from "../access-api";
import { insightRoutes, isNavigationActive, navigation, navigationPath, navigationSearch, navigationUsesProject } from "./AppNavigation";
import { useInsightFilters } from "./insights/shared";

function ProjectContextField({ label, description, children, retry, selectable = true }: {
  label: string;
  description?: string;
  children: ReactNode;
  retry?: ReactNode;
  selectable?: boolean;
}) {
  return <div className="app-project-context" role="group" aria-label={description ?? label}>
    <FolderKanban className="app-project-icon" aria-hidden="true" />
    <div className="app-project-field">
      <span className="sr-only">{label}</span>
      <div className="app-project-value">{children}{selectable && <ChevronDown aria-hidden="true" />}</div>
      {retry}
    </div>
  </div>;
}

export function projectDestination(pathname: string, project: AccessibleProject) {
  const current = navigation.find((item) => isNavigationActive(pathname, item.to));
  if (current && navigationUsesProject(pathname) && (current.permission === null || project.permissions.includes(current.permission))) {
    // Object IDs belong to their original project. Switch to the corresponding list.
    return navigationPath(current.to, project.id);
  }
  const fallback = [
    { to: `/projects/${encodeURIComponent(project.id)}/pipelines`, nav: "/projects/$projectId/pipelines" },
    { to: `/projects/${encodeURIComponent(project.id)}/explore`, nav: "/projects/$projectId/explore" }, { to: "/", nav: "/" },
    { to: "/operations", nav: "/operations" }, { to: "/analytics", nav: "/analytics" },
    { to: "/admin/audit", nav: "/admin/audit" },
  ].find(({ nav }) => {
    const item = navigation.find((entry) => entry.to === nav);
    return item?.permission && project.permissions.includes(item.permission);
  });
  return fallback?.to ?? "/access";
}

function ProjectSelector({ pathname, context }: {
  pathname: string;
  context: { label: string; value: string; projectId?: string };
}) {
  const projects = useQuery(accessibleProjectsQueryOptions);
  const navigate = useNavigate();
  const current = projects.data?.projects.find((project) => project.id === context.projectId);
  const name = current?.name ?? context.value;
  if (!projects.isError && (!projects.data || projects.data.projects.length === 0 || (projects.data.projects.length === 1 && current))) return null;
  return <ProjectContextField label={context.label} description={`${context.label}：${name}`} selectable={!!projects.data?.projects.length}
    retry={projects.isError && <button type="button" className="app-project-retry" onClick={() => void projects.refetch()}>重试项目列表</button>}>
    {projects.data?.projects.length ?
      <select aria-label="切换项目" title={name} value={current?.id ?? ""} onChange={(event) => {
        const project = projects.data?.projects.find((item) => item.id === event.target.value);
        if (project && project.id !== context.projectId) {
          const to = projectDestination(pathname, project);
          void navigate({ to, search: navigationSearch(to, project.id) });
        }
      }}>
        {!current && <option value="" disabled>{context.value}</option>}
        {projects.data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    : <strong title={context.value}>{name}</strong>}
  </ProjectContextField>;
}

function InsightProjectSelector() {
  const scope = useInsightFilters();
  const projects = scope.projects.data;
  const current = projects?.projects.find((project) => project.id === scope.filters.project_id);
  const hasProjects = !!projects && (projects.can_view_all || projects.projects.length > 0);
  if (!scope.projects.isError && (!projects || projects.projects.length <= 1)) return null;
  const unavailableLabel = scope.projects.isError ? "项目加载失败" : scope.projects.isPending ? "正在读取项目…" : "暂无可访问项目";
  return <ProjectContextField label="项目范围"
    retry={scope.projects.isError && <button type="button" className="app-project-retry" onClick={() => void scope.projects.refetch()}>重试项目列表</button>}>
    <select aria-label="项目范围" title={scope.filters.project_id === "*" ? "全部可访问项目" : current?.name} value={scope.filters.project_id ?? ""} disabled={!hasProjects} onChange={(event) => scope.update({ project_id: event.target.value }, true)}>
      {!hasProjects && <option value="">{unavailableLabel}</option>}
      {scope.projects.data?.can_view_all && <option value="*">全部可访问项目</option>}
      {scope.projects.data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
  </ProjectContextField>;
}

function AccessProjectSelector({ projectId }: { projectId?: string }) {
  const catalog = useQuery(catalogQueryOptions);
  const navigate = useNavigate();
  const projects = catalog.data?.projects ?? [];
  const current = projects.find((project) => project.id === projectId);
  if (!catalog.isError && projects.length <= 1) return null;
  return <ProjectContextField label="申请项目"
    retry={catalog.isError && <button type="button" className="app-project-retry" onClick={() => void catalog.refetch()}>重试项目目录</button>}>
    <select aria-label="选择权限申请项目" title={current?.name} value={current?.id ?? ""} disabled={!projects.length} onChange={(event) => void navigate({ to: "/access", search: { project_id: event.target.value } })}>
      {!current && <option value="" disabled>{catalog.isPending ? "正在读取项目…" : projects.length ? "请选择项目" : "暂无可申请项目"}</option>}
      {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
    </select>
  </ProjectContextField>;
}

export function ProjectContext(props: { pathname: string; context: { label: string; value: string; projectId?: string } }) {
  if (props.pathname === "/access") return <AccessProjectSelector projectId={props.context.projectId} />;
  if (insightRoutes.has(props.pathname)) return <InsightProjectSelector />;
  if (navigationUsesProject(props.pathname)) return <ProjectSelector {...props} />;
  return null;
}
