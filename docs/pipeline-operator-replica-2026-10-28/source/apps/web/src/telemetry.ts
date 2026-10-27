/** Explicit, content-free browser events. User identity is assigned by the API session. */
export type BehaviorKind = "page_view" | "page_leave" | "menu_click" | "button_click" | "button_exposure";
export interface InteractionContext { interaction_id: string; page_id: string }
export interface BehaviorEvent {
  event_id: string;
  occurred_at: string;
  kind: BehaviorKind;
  page_id: string;
  project_id?: string;
  element_id?: string;
  label?: string;
  duration_ms?: number;
  interaction_id?: string;
}

const routes: Array<[RegExp, string, string]> = [
  [/^\/$/, "dashboard", "概览"], [/^\/operations\/?$/, "data_operations", "数据运营明细"],
  [/^\/analytics\/?$/, "usage", "使用分析"], [/^\/admin\/audit\/?$/, "audit", "操作审计"],
  [/^\/events\/?$/, "events", "数据事件"], [/^\/requirements\/?$/, "requirements", "需求管理"],
  [/^\/requirements\/[^/]+\/?$/, "requirement_detail", "需求详情"],
  [/^\/projects\/[^/]+\/pipelines\/?$/, "pipelines", "数据流水线"],
  [/^\/pipelines\/?$/, "pipelines", "数据流水线"], [/^\/media\/?$/, "media", "数据探索"],
  [/^\/operators\/?$/, "operators", "算子与插件"],
  [/^\/projects\/[^/]+\/operators\/?$/, "operators", "算子与插件"],
  [/^\/projects\/[^/]+\/explore\/?$/, "media", "数据探索"],
  [/^\/projects\/[^/]+\/training\/?$/, "training", "视频训练平台"],
  [/^\/projects\/[^/]+\/datasets\/?$/, "datasets", "数据集"],
  [/^\/projects\/[^/]+\/datasets\/[^/]+\/?$/, "dataset_detail", "数据集详情"],
  [/^\/projects\/[^/]+\/annotation\/tasks\/?$/, "annotation_tasks", "标注任务"],
  [/^\/projects\/[^/]+\/annotation\/tasks\/[^/]+\/?$/, "annotation_task_detail", "标注任务详情"],
  [/^\/projects\/[^/]+\/annotation\/specs\/?$/, "annotation_specs", "标注规范"],
  [/^\/projects\/[^/]+\/annotation\/specs\/[^/]+\/?$/, "annotation_spec_detail", "标注规范详情"],
  [/^\/projects\/[^/]+\/evaluations\/?$/, "evaluations", "评测实验"],
  [/^\/projects\/[^/]+\/evaluations\/[^/]+\/?$/, "evaluation_detail", "评测实验详情"],
  [/^\/projects\/[^/]+\/benchmarks\/?$/, "benchmarks", "评测基准"],
  [/^\/projects\/[^/]+\/benchmarks\/[^/]+\/?$/, "benchmark_detail", "评测基准详情"],
  [/^\/projects\/[^/]+\/feedback\/?$/, "feedback", "问题反馈"],
  [/^\/projects\/[^/]+\/feedback\/[^/]+\/?$/, "feedback_detail", "问题反馈详情"],
  [/^\/projects\/[^/]+\/runs\/[^/]+\/?$/, "project_run_detail", "运行详情"],
  [/^\/projects\/[^/]+\/runs\/?$/, "project_runs", "运行中心"],
  [/^\/projects\/[^/]+\/settings\/connections\/?$/, "project_connections", "连接管理"],
  [/^\/admin\/users\/?$/, "admin_users", "用户与角色"], [/^\/admin\/access\/?$/, "admin_access", "权限管理"],
  [/^\/admin\/environments\/?$/, "admin_environments", "执行环境"],
  [/^\/notifications\/?$/, "notifications", "通知中心"], [/^\/access\/?$/, "access", "我的权限"],
];
export function pageForPath(pathname: string) {
  const match = routes.find(([pattern]) => pattern.test(pathname.split(/[?#]/)[0]));
  return match ? { id: match[1], label: match[2] } : null;
}

const pagePermissions: Record<string, string> = {
  training:"data_platform:read",
  dashboard: "dashboard:view", data_operations: "operations:read", usage: "analytics:read", audit: "audit:read",
  events: "events:read", requirements: "requirements:read", requirement_detail: "requirements:read",
  pipelines: "pipelines:read", operators: "pipelines:read", media: "media:read", admin_users: "users:read", admin_access: "access:read",
  datasets: "media:read", dataset_detail: "media:read",
  annotation_tasks: "media:read", annotation_task_detail: "media:read", annotation_specs: "media:read", annotation_spec_detail: "media:read",
  evaluations: "analytics:read", evaluation_detail: "analytics:read", benchmarks: "analytics:read", benchmark_detail: "analytics:read",
  feedback: "requirements:read", feedback_detail: "requirements:read",
  project_runs: "pipelines:read", project_run_detail: "pipelines:read", project_connections: "connections:read", admin_environments: "environments:read",
};
export function canTrackPage(pathname: string, permissions: readonly string[]) {
  const page = pageForPath(pathname);
  return Boolean(page && (!pagePermissions[page.id] || permissions.includes(pagePermissions[page.id])));
}

/** Read only the declared project selector; no other URL or search content enters an event. */
export function projectForLocation(pathname: string, search: string, defaultProjectId?: string) {
  const projectRoute = pathname.match(/^\/projects\/([^/]+)(?:\/|$)/);
  if (projectRoute) {
    const projectId = decodeURIComponent(projectRoute[1]);
    return projectId.length <= 80 ? projectId : defaultProjectId;
  }
  const requested = pageForPath(pathname) ? new URLSearchParams(search).get("project_id") : null;
  return requested && requested !== "*" && requested.length <= 80 ? requested : defaultProjectId;
}

const validId = /^[A-Za-z0-9_.:/-]{1,120}$/;
const batchSize = 50;
const queueLimit = 200;
type Session = { key: string; csrf: string; defaultProjectId?: string };
type Visit = { path: string; id: string; projectId?: string; label: string; visibleSince: number | null; elapsed: number; exposed: Set<string> };

export class BehaviorCollector {
  private session: Session | null = null;
  private visit: Visit | null = null;
  private queue: BehaviorEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | null = null;
  private paused = false;
  private generation = 0;
  constructor(
    private readonly transport: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = () => performance.now(),
    private readonly visible: () => boolean = () => document.visibilityState === "visible",
  ) {}

  configure(key: string, csrf: string, defaultProjectId?: string) {
    if (this.session?.key !== key) {
      // Never flush stale events after learning that the server identity has changed.
      this.discard();
      this.visit = null;
      this.generation++;
      this.paused = false;
    }
    this.session = { key, csrf, defaultProjectId };
  }

  navigate(pathname: string, projectId?: string) {
    pathname = pathname.split(/[?#]/)[0];
    projectId = projectId && projectId !== "*" ? projectId : this.session?.defaultProjectId;
    if (!this.session || this.paused || (this.visit?.path === pathname && this.visit.projectId === projectId)) return;
    this.leave();
    const page = pageForPath(pathname);
    if (!page) return;
    this.visit = { path: pathname, id: page.id, projectId, label: page.label, visibleSince: this.visible() ? this.now() : null, elapsed: 0, exposed: new Set() };
    this.enqueue({ kind: "page_view", page_id: page.id, project_id: projectId, label: page.label });
  }

  visibilityChanged(isVisible: boolean) {
    if (!this.visit || this.paused) return;
    if (this.visit.visibleSince !== null && !isVisible) {
      this.visit.elapsed += this.now() - this.visit.visibleSince;
      this.visit.visibleSince = null;
    } else if (this.visit.visibleSince === null && isVisible) this.visit.visibleSince = this.now();
    if (!isVisible) void this.flush(true);
  }

  leave() {
    const visit = this.visit;
    this.visit = null;
    if (!visit) return;
    const duration = visit.elapsed + (visit.visibleSince === null ? 0 : this.now() - visit.visibleSince);
    this.enqueue({ kind: "page_leave", page_id: visit.id, project_id: visit.projectId, label: visit.label, duration_ms: Math.min(86_400_000, Math.max(0, Math.round(duration))) });
  }

  click(elementId: string, label: string, kind: "button_click" | "menu_click" = "button_click"): InteractionContext | undefined {
    if (!this.visit || !this.session || this.paused || !validId.test(elementId)) return;
    const interaction = { interaction_id: crypto.randomUUID(), page_id: this.visit.id };
    this.enqueue({ kind, element_id: elementId, project_id: this.visit.projectId, label: label.slice(0, 120), ...interaction });
    return interaction;
  }

  expose(elementId: string, label: string) {
    if (!this.visit || this.paused || !this.visible() || !validId.test(elementId) || this.visit.exposed.has(elementId)) return;
    this.visit.exposed.add(elementId);
    this.enqueue({ kind: "button_exposure", page_id: this.visit.id, project_id: this.visit.projectId, element_id: elementId, label: label.slice(0, 120) });
  }

  private enqueue(event: Omit<BehaviorEvent, "event_id" | "occurred_at">) {
    if (!this.session || this.paused) return;
    this.queue.push({ ...event, event_id: crypto.randomUUID(), occurred_at: new Date().toISOString() });
    if (this.queue.length > queueLimit) this.queue.splice(0, this.queue.length - queueLimit);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, 750);
  }

  async flush(keepalive = false): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.inFlight) { await this.inFlight; if (this.queue.length) await this.flush(keepalive); return; }
    if (!this.session || !this.queue.length) return;
    const generation = this.generation;
    const csrf = this.session.csrf;
    const events = this.queue.splice(0, batchSize);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    // Failures are intentionally dropped. Telemetry never retries indefinitely or blocks a business action.
    this.inFlight = (async () => {
      try {
        await this.transport(`${import.meta.env.VITE_API_BASE_URL ?? ""}/api/insights/events`, {
          method: "POST", credentials: "include", keepalive,
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          body: JSON.stringify({ events }), signal: controller.signal,
        });
      } catch { /* Best-effort collection: navigation and actions must still work. */ }
      finally { clearTimeout(timeout); }
    })();
    await this.inFlight;
    this.inFlight = null;
    if (generation === this.generation && this.queue.length) await this.flush(keepalive);
  }

  async changeIdentity<T>(action: () => Promise<T>): Promise<T> {
    const previousVisit = this.visit;
    this.leave();
    this.paused = true;
    await this.flush();
    this.discard();
    try { return await action(); }
    catch (error) {
      this.paused = false;
      if (previousVisit) this.navigate(previousVisit.path, previousVisit.projectId);
      throw error;
    }
  }

  discard() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue = [];
  }
}

export const behavior = new BehaviorCollector();
const interactions = new WeakMap<object, InteractionContext>();
export function interactionForEvent(event?: object): InteractionContext | undefined { return event ? interactions.get(event) : undefined; }

/** Context is supplied by the initiating handler; requests never inherit a global "last click". */
export function instrumentedFetch(input: RequestInfo | URL, init?: RequestInit, interaction?: InteractionContext) {
  if (!interaction) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set("X-Interaction-Id", interaction.interaction_id);
  headers.set("X-Page-Id", interaction.page_id);
  return fetch(input, { ...init, headers });
}

/** Watch only developer-labelled controls; never inspect textContent, values, URLs or arbitrary DOM text. */
export function observeBehavior(root: Document = document, collector = behavior) {
  const observed = new Set<Element>();
  const intersecting = new Set<Element>();
  let submitClick: { element: Element; interaction: InteractionContext } | null = null;
  let submitTimer: ReturnType<typeof setTimeout> | undefined;
  const eligible = (element: Element) => element.getAttribute("data-track-kind") !== "menu_click";
  const expose = (element: Element) => {
    const style = getComputedStyle(element);
    if (eligible(element) && !element.closest('[hidden], [aria-hidden="true"], [inert]') && style.visibility !== "hidden" && style.display !== "none") {
      collector.expose(element.getAttribute("data-track-id") ?? "", element.getAttribute("data-track-label") ?? "");
    }
  };
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio > 0) { intersecting.add(entry.target); expose(entry.target); }
      else intersecting.delete(entry.target);
    }
  }, { threshold: [0, 0.01] });
  const scan = () => {
    for (const element of observed) if (!element.isConnected) { observer?.unobserve(element); observed.delete(element); intersecting.delete(element); }
    root.querySelectorAll("[data-track-id]").forEach((element) => {
      if (observed.has(element)) return;
      observed.add(element);
      if (eligible(element)) observer?.observe(element);
    });
    intersecting.forEach(expose);
  };
  const mutation = new MutationObserver(scan);
  mutation.observe(root.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-track-id", "data-track-label", "hidden", "aria-hidden", "class", "style"] });
  const click = (event: Event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-track-id]") : null;
    if (!target || target.matches(":disabled, [aria-disabled='true']")) return;
    const interaction = collector.click(target.getAttribute("data-track-id") ?? "", target.getAttribute("data-track-label") ?? "", target.getAttribute("data-track-kind") === "menu_click" ? "menu_click" : "button_click");
    if (!interaction) return;
    interactions.set(event, interaction);
    if (target instanceof HTMLButtonElement && target.type === "submit") {
      submitClick = { element: target, interaction };
      if (submitTimer) clearTimeout(submitTimer);
      submitTimer = setTimeout(() => { submitClick = null; }, 0);
    }
  };
  const submit = (event: Event) => {
    const submitter = (event as SubmitEvent).submitter;
    const element = submitter?.closest("[data-track-id]") ?? (event.target instanceof HTMLFormElement ? event.target.querySelector('[type="submit"][data-track-id]') : null);
    if (!element || element.matches(":disabled, [aria-disabled='true']")) return;
    const context = submitClick?.element === element ? submitClick.interaction : collector.click(element.getAttribute("data-track-id") ?? "", element.getAttribute("data-track-label") ?? "");
    if (context) interactions.set(event, context);
    submitClick = null;
  };
  const visibility = () => { collector.visibilityChanged(root.visibilityState === "visible"); if (root.visibilityState === "visible") scan(); };
  const hide = () => { collector.leave(); void collector.flush(true); };
  const show = (event: PageTransitionEvent) => { if (event.persisted) { collector.navigate(window.location.pathname, projectForLocation(window.location.pathname, window.location.search)); scan(); } };
  root.addEventListener("click", click, true);
  root.addEventListener("submit", submit, true);
  root.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", show);
  scan();
  return () => {
    mutation.disconnect(); observer?.disconnect();
    if (submitTimer) clearTimeout(submitTimer);
    root.removeEventListener("click", click, true); root.removeEventListener("submit", submit, true);
    root.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show);
  };
}
