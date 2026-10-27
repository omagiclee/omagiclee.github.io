import { Dialog } from "@base-ui/react/dialog";
import { Link } from "@tanstack/react-router";
import { Activity, Images, Cpu, BarChart3, Beaker, BookOpenCheck, ChevronDown, ClipboardList, Database, GitBranch, KeyRound, LayoutDashboard, Menu, MessageSquareWarning, Package, ScrollText, Search, Server, ShieldCheck, Tags, UsersRound, X, type LucideIcon } from "lucide-react";
import { Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ScopeView } from "../auth-api";
import { useAuth, useProjectAuth } from "../auth-context";
import { Button } from "./ui/button";

interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: string | null;
  group: string;
  track: string;
  hidden?: boolean;
}

// Page metadata also covers secondary routes, so hiding an entry never removes its access check.
export const navigation: readonly NavigationItem[] = [
  { to: "/", label: "概览", icon: LayoutDashboard, permission: "dashboard:view", group: "概览", track: "dashboard" },
  { to: "/requirements", label: "需求管理", icon: ClipboardList, permission: "requirements:read", group: "需求管理", track: "requirements" },
  { to: "/projects/$projectId/datasets", label: "数据集", icon: Database, permission: "data_platform:read", group: "数据管理", track: "datasets" },
  { to: "/projects/$projectId/explore", label: "数据探索", icon: Search, permission: "media:read", group: "数据管理", track: "explore" },
  { to: "/projects/$projectId/auto-gt", label: "影像 AutoGT", icon: Images, permission: "data_platform:read", group: "数据管理", track: "auto_gt" },
  { to: "/projects/$projectId/pipelines", label: "数据流水线", icon: GitBranch, permission: "pipelines:read", group: "数据开发", track: "pipelines" },
  { to: "/projects/$projectId/operators", label: "算子与插件", icon: Package, permission: "pipelines:read", group: "数据开发", track: "operators" },
  { to: "/projects/$projectId/annotation/tasks", label: "标注任务", icon: BookOpenCheck, permission: "data_platform:read", group: "数据管理", track: "annotation_tasks" },
  { to: "/projects/$projectId/annotation/specs", label: "标注规范", icon: Tags, permission: "data_platform:read", group: "数据管理", track: "annotation_specs" },
  { to: "/projects/$projectId/training", label: "视频训练平台", icon: Cpu, permission: "data_platform:read", group: "训练与模型", track: "training" },
  { to: "/projects/$projectId/evaluations", label: "评测实验", icon: Beaker, permission: "data_platform:read", group: "评测与反馈", track: "evaluations" },
  { to: "/projects/$projectId/benchmarks", label: "评测基准", icon: BarChart3, permission: "data_platform:read", group: "评测与反馈", track: "benchmarks" },
  { to: "/projects/$projectId/feedback", label: "问题反馈", icon: MessageSquareWarning, permission: "data_platform:read", group: "评测与反馈", track: "feedback" },
  { to: "/projects/$projectId/runs", label: "运行中心", icon: Activity, permission: "pipelines:read", group: "运行中心", track: "runs" },
  { to: "/projects/$projectId/settings/connections", label: "连接管理", icon: KeyRound, permission: "connections:read", group: "连接管理", track: "connections" },
  { to: "/admin/users", label: "用户与角色", icon: UsersRound, permission: "users:read", group: "平台管理", track: "users" },
  { to: "/admin/access", label: "权限管理", icon: ShieldCheck, permission: "access:read", group: "平台管理", track: "admin_access" },
  { to: "/admin/environments", label: "执行环境", icon: Server, permission: "environments:read", group: "平台管理", track: "environments", hidden: true },
  { to: "/analytics", label: "使用分析", icon: BarChart3, permission: "analytics:read", group: "平台管理", track: "analytics" },
  { to: "/admin/audit", label: "操作审计", icon: ScrollText, permission: "audit:read", group: "平台管理", track: "audit" },
  { to: "/operations", label: "数据运营明细", icon: BarChart3, permission: "operations:read", group: "概览", track: "operations", hidden: true },
  { to: "/events", label: "数据事件", icon: Activity, permission: "events:read", group: "概览", track: "events", hidden: true },
  { to: "/access", label: "我的权限", icon: ShieldCheck, permission: null, group: "账号", track: "access", hidden: true },
];

const groups = [
  { label: "概览", icon: LayoutDashboard, area: "main", direct: true },
  { label: "需求管理", icon: ClipboardList, area: "main", direct: true },
  { label: "数据管理", icon: Database, area: "main", direct: false },
  { label: "数据开发", icon: GitBranch, area: "main", direct: false },
  { label: "训练与模型", icon: Cpu, area: "main", direct: true },
  { label: "评测与反馈", icon: Beaker, area: "main", direct: false },
  { label: "运行中心", icon: Activity, area: "main", direct: true },
  { label: "连接管理", icon: KeyRound, area: "settings", direct: true },
  { label: "平台管理", icon: ShieldCheck, area: "settings", direct: false },
] as const;

export function isNavigationActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  if (to === "/projects/$projectId/pipelines" && pathname === "/pipelines") return true;
  if (to === "/projects/$projectId/operators" && pathname === "/operators") return true;
  if (to === "/projects/$projectId/explore" && pathname === "/media") return true;
  const pattern = to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\$projectId", "[^/]+");
  return new RegExp(`^${pattern}(?:/|$)`).test(pathname);
}

const projectRoutes = new Set(["/pipelines", "/operators", "/media", "/access"]);
export const insightRoutes = new Set(["/", "/operations", "/analytics", "/admin/audit"]);

export function navigationUsesProject(to: string) {
  return to.startsWith("/projects/") || projectRoutes.has(to) || insightRoutes.has(to);
}

export function navigationPath(to: string, projectId?: string) {
  return to.includes("$projectId") ? to.replace("$projectId", encodeURIComponent(projectId ?? "demo")) : to;
}

/** Match the existing pages' project resolution; this is a label, not a project switcher. */
export function navigationContext(pathname: string, search: string, scope: ScopeView) {
  const projectRoute = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  if (projectRoute) {
    const projectId = decodeURIComponent(projectRoute[1]);
    return { label: "当前项目", value: projectId, projectId };
  }
  const parameter = new URLSearchParams(search).get("project_id");
  const requested = parameter && parameter !== "*" && parameter.length <= 80 ? parameter : undefined;
  if (projectRoutes.has(pathname)) {
    const projectId = requested ?? (scope.type === "project" ? scope.id : "demo");
    return { label: "当前项目", value: projectId, projectId };
  }
  if (insightRoutes.has(pathname)) {
    if (parameter === "*") return { label: "项目范围", value: "全部可访问项目", projectId: undefined };
    if (requested) return { label: "当前项目", value: requested, projectId: requested };
    // Insights resolves its default through /insights/projects, independently of the session.
    return { label: "项目范围", value: "正在读取项目…", projectId: undefined };
  }
  return scope.type === "project"
    ? { label: "会话项目", value: scope.id, projectId: scope.id }
    : { label: scope.type === "resource" ? "资源范围" : "会话范围", value: scope.type === "resource" ? scope.id : "全平台", projectId: undefined };
}

export function navigationSearch(to: string, projectId?: string) {
  // Do not carry object IDs, filters, or a project parameter into pages that do not consume it.
  return projectId && !to.startsWith("/projects/") && navigationUsesProject(to) ? { project_id: projectId } : {};
}

function NavigationGroup({ group, items, pathname, projectId, insightProjectId, onNavigate }: {
  group: typeof groups[number]; items: NavigationItem[]; pathname: string; projectId?: string; insightProjectId?: string; onNavigate?: () => void;
}) {
  const active = navigation.some((item) => item.group === group.label && isNavigationActive(pathname, item.to));
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  useEffect(() => { if (active) setExpanded(true); }, [active, pathname]);
  const links = items.map((item) => {
    const selected = isNavigationActive(pathname, item.to);
    return <Link key={item.to} to={navigationPath(item.to, projectId)} search={navigationSearch(item.to, insightRoutes.has(item.to) ? insightProjectId ?? projectId : projectId)}
      className="app-nav-link" data-active={selected} aria-current={selected ? "page" : undefined}
      data-track-id={`nav.${item.track}`} data-track-label={item.label} data-track-kind="menu_click" onClick={onNavigate}>
      {group.direct && <item.icon aria-hidden="true" />}<span>{item.label}</span>
    </Link>;
  });
  if (group.direct) return <div className="app-nav-direct">{links}</div>;
  return <section className="app-nav-group" data-nav-group={group.label} aria-label={group.label}>
    <button className="app-nav-group-toggle" type="button" aria-expanded={expanded} aria-controls={id} data-active={active} onClick={() => setExpanded(!expanded)}>
      <group.icon aria-hidden="true" /><span>{group.label}</span><ChevronDown className="app-nav-chevron" aria-hidden="true" />
    </button>
    <div id={id} className="app-nav-children" hidden={!expanded}>{links}</div>
  </section>;
}

export function NavigationItems({ pathname, projectId, insightProjectId, onNavigate, area = "all" }: { pathname: string; projectId?: string; insightProjectId?: string; onNavigate?: () => void; area?: "main" | "settings" | "all" }) {
  const session = useAuth();
  const project = useProjectAuth(projectId);
  const canOpenOverview = (insightProjectId === "*" ? session : project).can("dashboard:view");
  const visible = navigation.filter((item) => (!item.hidden || (!canOpenOverview && ["/events", "/operations"].includes(item.to))) && (!item.to.startsWith("/projects/") || !!projectId) && (item.permission === null || (navigationUsesProject(item.to) && !(insightRoutes.has(item.to) && insightProjectId === "*") ? project : session).can(item.permission)));
  return groups.filter((group) => area === "all" || group.area === area).map((group) => {
    const items = visible.filter((item) => item.group === group.label);
    return items.length > 0 && <NavigationGroup key={group.label} group={group} items={items} pathname={pathname} projectId={projectId} insightProjectId={insightProjectId} onNavigate={onNavigate} />;
  });
}

export function MobileNavigation({ pathname, projectId, insightProjectId, projectSwitcher }: { pathname: string; search: string; projectId?: string; insightProjectId?: string; projectSwitcher?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigated = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [drawer, setDrawer] = useState<HTMLElement | null>(null);
  const pendingInitialFocus = useRef(false);
  const initialTarget = useRef<HTMLElement | null>(null);
  const navigationTarget = (element: HTMLElement | null) => {
    const links = [...(element?.querySelectorAll<HTMLElement>(".app-nav-link") ?? [])].filter((link) => {
      for (let node: HTMLElement | null = link; node && node !== element; node = node.parentElement) {
        if (node.hidden || node.style.display === "none") return false;
      }
      return true;
    });
    return links.find((link) => link.getAttribute("aria-current") === "page") ?? links[0] ?? null;
  };
  // Suspended project permissions can leave only the close button on first open.
  // Complete initial focus once links mount, unless the user has already acted.
  useEffect(() => {
    if (!open || !drawer) return;
    const focusWhenReady = () => {
      if (!pendingInitialFocus.current) return;
      const target = navigationTarget(drawer);
      if (!target) return;
      const active = document.activeElement;
      const fallback = drawer.querySelector('[aria-label="关闭主导航"]');
      if (active === target) { initialTarget.current = target; return; }
      // Permission discovery can replace an already-focused session-only link.
      // Repair that lost initial focus, while preserving any deliberate focus.
      if (active === document.body || active === drawer || active === fallback || (active === initialTarget.current && !initialTarget.current?.isConnected)) {
        initialTarget.current = target;
        target.focus();
      }
    };
    const observer = new MutationObserver(focusWhenReady);
    observer.observe(drawer, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-current", "hidden", "style"] });
    focusWhenReady();
    return () => observer.disconnect();
  }, [open, drawer]);
  // Filter and project discovery may resolve after the drawer was opened.
  // Navigation links close it immediately; unrelated query updates must not.
  useEffect(() => { setOpen(false); }, [pathname]);
  // A drawer opened on a phone must not leave the desktop shell inert after resizing.
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (query.matches) setOpen(false); };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);
  return <Dialog.Root open={open} onOpenChange={(next) => { if (next) { navigated.current = false; initialTarget.current = null; } pendingInitialFocus.current = next; setOpen(next); }}>
    <Dialog.Trigger ref={trigger} className="app-menu-trigger" render={<Button variant="ghost" size="icon" />} aria-label="打开主导航" data-track-id="nav.open" data-track-label="打开主导航"><Menu aria-hidden="true" /></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="app-nav-backdrop" />
      <Dialog.Popup ref={setDrawer} className="app-nav-drawer" onKeyDownCapture={() => { pendingInitialFocus.current = false; }} onPointerDownCapture={() => { pendingInitialFocus.current = false; }} initialFocus={() => {
        const target = navigationTarget(drawer);
        if (target) initialTarget.current = target;
        return target;
      }} finalFocus={() => navigated.current ? document.getElementById("main-content") : trigger.current}>
        <div className="app-drawer-heading"><Dialog.Title>Data Flywheel</Dialog.Title><Dialog.Close render={<Button variant="ghost" size="icon" />} aria-label="关闭主导航"><X aria-hidden="true" /></Dialog.Close></div>
        <Dialog.Description className="app-drawer-description">按工作职责浏览平台功能</Dialog.Description>
        {projectSwitcher}
        <nav aria-label="主导航" className="app-drawer-navigation"><Suspense fallback={<span>正在读取导航权限…</span>}><NavigationItems pathname={pathname} projectId={projectId} insightProjectId={insightProjectId} onNavigate={() => { navigated.current = true; setOpen(false); }} /></Suspense></nav>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
