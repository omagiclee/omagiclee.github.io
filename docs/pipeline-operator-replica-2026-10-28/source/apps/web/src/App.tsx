import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { ChevronRight, Clock3, LoaderCircle, RotateCw, ShieldCheck } from "lucide-react";
import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AuthProvider, useAuth, useProjectAuth } from "./auth-context";
import { accessibleProjectsQueryOptions, stopImpersonation } from "./auth-api";
import { insightProjectsOptions } from "./insights-api";
import { catalogQueryOptions } from "./access-api";
import { AppAccountMenu } from "./components/AppAccountMenu";
import { Button } from "./components/ui/button";
import { NotificationBell } from "./components/NotificationBell";
import { PermissionRequestButton } from "./components/PermissionRequestButton";
import { BehaviorTracker } from "./components/BehaviorTracker";
import { ProjectContext } from "./components/ProjectContext";
import { interactionForEvent, type InteractionContext } from "./telemetry";
import { MobileNavigation, NavigationItems, insightRoutes, isNavigationActive, navigation, navigationContext, navigationPath, navigationSearch, navigationUsesProject } from "./components/AppNavigation";
import "./components/app-shell.css";

function ProtectedOutlet({ pathname, projectId }: { pathname: string; projectId?: string }) {
  const page = navigation.find((item) => isNavigationActive(pathname, item.to));
  const scopedProject = page && navigationUsesProject(page.to) ? projectId : undefined;
  // Statistics resolve their scope through the project directory before checking access.
  const ownsScopeResolution = insightRoutes.has(pathname);
  const { me, can } = useProjectAuth(page?.permission && !ownsScopeResolution ? scopedProject : undefined);
  if (!ownsScopeResolution && page?.permission && !can(page.permission)) return <main className="md-page"><section className="mx-auto max-w-lg rounded-2xl bg-[var(--md-sys-color-surface-container-low)] p-8">
    <ShieldCheck className="mb-4 size-9 text-primary" aria-hidden="true" /><h1 className="md-page-title">需要访问权限</h1>
    <p className="my-4 text-muted-foreground">当前账号尚未获得{scopedProject ? `项目「${scopedProject}」的` : ""}「{page.label}」访问权限。</p>
    {page.to.startsWith("/admin") ? <p className="text-sm text-muted-foreground">请联系平台管理员配置管理权限。</p> : <PermissionRequestButton projectId={scopedProject} permission={page.permission} label={`申请${page.label}权限`} />}
    <Link to="/access" search={{ project_id: scopedProject }} className="app-recovery-link mt-4">查看我的权限与申请记录</Link>
  </section></main>;
  return <Outlet key={`${me.user.id}:${scopedProject ?? "global"}:${me.permissions.join(",")}`} />;
}

function BrandMark() {
  return (
    <div className="app-brand-mark">
      <RotateCw className="size-6" aria-hidden="true" />
    </div>
  );
}

function ImpersonationBanner() {
  const { me } = useAuth();
  const mutation = useMutation({
    mutationFn: (interaction?: InteractionContext) => stopImpersonation(me.csrf_token, interaction),
    onSuccess: () => {
      window.location.reload();
    },
  });

  if (!me.impersonation.active) return null;

  const expiresAt = me.impersonation.expires_at
    ? new Date(me.impersonation.expires_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : "即将";

  return (
    <aside className="bg-[var(--md-sys-color-warning-container)] text-[var(--md-sys-color-on-warning-container)]" aria-label="代登录状态">
      <div className="mx-auto flex min-h-12 w-full max-w-[90rem] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 md:px-8">
        <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
        <p className="md-body-medium min-w-0 flex-1">
          当前以 <strong>{me.user.display_name}</strong> 身份操作；实际操作者为 {me.actor.display_name}
        </p>
        <span className="md-body-small flex items-center gap-1 whitespace-nowrap"><Clock3 className="size-4" />{expiresAt} 自动结束</span>
        <Button data-track-id="account.stop_impersonation" data-track-label="退出代登录" variant="outline" size="sm" disabled={mutation.isPending} onClick={(event) => mutation.mutate(interactionForEvent(event.nativeEvent))}>
          {mutation.isPending && <LoaderCircle className="animate-spin" />}退出代登录
        </Button>
        {mutation.isError && <span className="md-body-small w-full text-destructive" role="alert">{mutation.error.message}</span>}
      </div>
    </aside>
  );
}

function AuthenticatedApp() {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const [pageHeading, setPageHeading] = useState("");
  useLayoutEffect(() => {
    const header = headerRef.current;
    const shell = shellRef.current;
    if (!header || !shell) return;
    const measure = () => shell.style.setProperty("--console-header-height", `${header.getBoundingClientRect().height}px`);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const { me, can } = useAuth();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.searchStr });
  const projects = useQuery(accessibleProjectsQueryOptions);
  const insightProjects = useQuery({ ...insightProjectsOptions, enabled: insightRoutes.has(pathname) });
  const accessCatalog = useQuery({ ...catalogQueryOptions, enabled: pathname === "/access" });
  const baseContext = navigationContext(pathname, search, me.scope);
  const insightProjectId = new URLSearchParams(search).get("project_id") || insightProjects.data?.default_project_id;
  const requestedAccessProject = new URLSearchParams(search).get("project_id");
  const defaultAccessProject = accessCatalog.data?.projects.find((project) => project.id === (me.scope.type === "project" ? me.scope.id : ""))?.id ?? accessCatalog.data?.projects[0]?.id;
  const context = insightRoutes.has(pathname) && insightProjectId
    ? { label: "项目范围", value: insightProjectId === "*" ? "全部可访问项目" : insightProjectId, projectId: insightProjectId === "*" ? undefined : insightProjectId }
    : pathname === "/access" && (requestedAccessProject || defaultAccessProject)
    ? { label: "申请项目", value: requestedAccessProject || defaultAccessProject!, projectId: requestedAccessProject || defaultAccessProject }
    : baseContext;
  const accessibleProjects = projects.data?.projects ?? [];
  const navigationProjectId = accessibleProjects.find((project) => project.id === context.projectId)?.id
    ?? accessibleProjects.find((project) => project.id === (me.scope.type === "project" ? me.scope.id : ""))?.id
    ?? accessibleProjects.find((project) => project.id === projects.data?.default_project_id)?.id
    ?? accessibleProjects[0]?.id;
  const reportingProjectId = insightRoutes.has(pathname) ? insightProjectId : navigationProjectId;
  const page = navigation.find((item) => isNavigationActive(pathname, item.to));
  useEffect(() => {
    // Observe the rendered object heading so async detail loads also update browser tabs.
    const updateTitle = () => {
      const heading = (document.querySelector("#main-content .plugin-detail-heading h2") ?? document.querySelector("#main-content h1"))?.textContent?.trim();
      setPageHeading(heading ?? "");
      const label = heading || page?.label || (pathname === "/notifications" ? "通知中心" : "Data Flywheel");
      const params = new URLSearchParams(search);
      const view = params.get("view");
      const detail = params.get("tab") || (view === "runs" ? "运行记录" : view === "versions" ? "版本" : view === "development" ? "插件开发" : "");
      document.title = [label, detail, context.projectId, "Data Flywheel"].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ");
    };
    updateTitle();
    const main = document.getElementById("main-content");
    const observer = new MutationObserver(updateTitle);
    if (main) observer.observe(main, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, search, page?.label, context.projectId]);

  const sectionPages = page ? navigation.filter((item) => item.group === page.group && !item.hidden) : [];
  const showSection = Boolean(page && page.group !== page.label && (sectionPages.length > 1 || page.hidden));
  const targetProject = accessibleProjects.find((project) => project.id === context.projectId);
  const sectionDestination = sectionPages.find((item) => item.permission === null || (navigationUsesProject(item.to) && !(insightRoutes.has(item.to) && reportingProjectId === "*")
    ? targetProject?.permissions.includes(item.permission) : can(item.permission)));
  const aliases = ["/pipelines", "/operators", "/media"];
  const pagePath = page ? (aliases.includes(pathname) ? pathname : navigationPath(page.to, context.projectId)) : pathname;
  const locationParams = new URLSearchParams(search);
  const view = locationParams.get("view");
  const viewLabel = view === "new" && page?.to === "/projects/$projectId/pipelines" ? "新建流水线" : view === "runs" ? "运行记录" : view === "versions" ? "版本" : view === "development" ? "插件开发" : "";
  const objectDetail = pathname !== pagePath || ["pluginId", "releaseId", "pipelineId", "runId"].some((key) => locationParams.has(key));
  const detailLabel = page && objectDetail && pageHeading ? pageHeading : viewLabel;
  const locationLabel = page?.label ?? (pathname === "/notifications" ? "通知中心" : pageHeading || "Data Flywheel");

  return (
    <div ref={shellRef} className="app-shell min-h-screen bg-background">
      <a className="app-skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>跳到主要内容</a>
      <BehaviorTracker />
      <aside className="app-sidebar">
        <div className="app-sidebar-brand"><BrandMark /><span>Data Flywheel</span></div>
        <ProjectContext pathname={pathname} context={context} />
        <nav className="app-sidebar-navigation" aria-label="主导航">
          <Suspense fallback={<span>正在读取导航权限…</span>}><NavigationItems pathname={pathname} projectId={navigationProjectId} insightProjectId={reportingProjectId} area="main" /></Suspense>
        </nav>
        <nav className="app-sidebar-settings" aria-label="设置与管理">
          <Suspense fallback={null}><NavigationItems pathname={pathname} projectId={navigationProjectId} insightProjectId={reportingProjectId} area="settings" /></Suspense>
        </nav>
      </aside>

      <div className="app-shell-content">
        <header ref={headerRef} className="app-header">
          <div className="app-header-row">
            <MobileNavigation pathname={pathname} search={search} projectId={navigationProjectId} insightProjectId={reportingProjectId} projectSwitcher={<ProjectContext pathname={pathname} context={context} />} />
            <nav className="app-breadcrumb" aria-label="当前位置">
              <ol>
                {showSection && <li className="app-breadcrumb-ancestor">
                  {sectionDestination && navigationPath(sectionDestination.to, context.projectId) !== pathname ? <Link activeOptions={{ exact: true }} to={navigationPath(sectionDestination.to, context.projectId)} search={navigationSearch(sectionDestination.to, insightRoutes.has(sectionDestination.to) ? reportingProjectId : context.projectId)}>{page!.group}</Link> : <span>{page!.group}</span>}
                  <ChevronRight aria-hidden="true" />
                </li>}
                <li className="app-breadcrumb-location">
                  {detailLabel && page ? <Link activeOptions={{ exact: true }} aria-label={`返回${page.label}`} to={pagePath} search={navigationSearch(pagePath, context.projectId)}>{locationLabel}</Link> : <span aria-current="page">{locationLabel}</span>}
                </li>
                {detailLabel && <li className="app-breadcrumb-detail"><ChevronRight aria-hidden="true" /><span aria-current="page">{detailLabel}</span></li>}
              </ol>
            </nav>
            <div className="app-header-actions"><NotificationBell /><AppAccountMenu projectId={navigationProjectId} /></div>
          </div>
          <ImpersonationBanner />
        </header>
        <div id="main-content" className="app-main-content" tabIndex={-1}>
          <ProtectedOutlet pathname={pathname} projectId={context.projectId} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <AuthProvider><AuthenticatedApp /></AuthProvider>;
}
