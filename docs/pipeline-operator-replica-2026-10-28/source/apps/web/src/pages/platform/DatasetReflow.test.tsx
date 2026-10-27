import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetDetailPage, DatasetsPage } from "./DatasetPages";
const context = vi.hoisted(() => ({ search: "", datasets: [] as any[], tasks: [] as any[] }));
vi.mock("@tanstack/react-router", () => ({ useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { pathname: "/projects/demo/datasets/dataset", searchStr: context.search } }), useNavigate: () => vi.fn(), Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a> }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(), useQuery: () => ({ data: undefined, error: null, isPending: false }) }));
vi.mock("./platform-store", async original => ({ ...await original<typeof import("./platform-store")>(), usePlatform: () => ({ id: "dataset", state: { datasets: context.datasets, tasks: context.tasks, specs: [], experiments: [], benchmarks: [], feedback: [], users: [], models: [], selections: [], trainingRuns: [], catalogs: {}, page: { total: 1, nextCursor: null, resource: "datasets" } }, path: (suffix: string) => `/projects/demo/${suffix}`, projectId: "demo", can: () => true, write: vi.fn() }) }));
const source = JSON.stringify({ schema: "media.failure-reflow.v1", issue: "人工确认误召回", query: { mode: "text", query: "森林" }, evaluation_id: "evaluation", candidate_snapshot_id: "fixed-pool", schemes: [{ search_id: "session", label: "基础检索" }], review_source: "test_fixture", request_digest: "raw-json-must-not-appear" });
beforeEach(() => { context.search = ""; context.tasks = []; context.datasets = [{ id: "dataset", name: "森林问题镜头", modality: "视频", purpose: "检索诊断", source, revision: 1, samples: [], versions: [], sampleCount: 1, pendingCount: 1 }]; });
afterEach(cleanup);
describe("dataset reflow user-facing evidence", () => {
  it("renders a concise source in the dataset list", () => {
    render(<DatasetsPage />);
    expect(screen.getByText("视频 · 检索失败回流")).toBeInTheDocument();
    expect(screen.queryByText(/raw-json-must-not-appear/)).not.toBeInTheDocument();
  });
  it("links lineage to the original evaluation and search without exposing the provenance JSON", () => {
    context.search = "?tab=血缘与使用"; context.tasks = [{ id: "task", name: "相关性返工", datasetId: "dataset" }];
    render(<DatasetDetailPage />);
    expect(screen.getByText("人工确认误召回")).toBeInTheDocument();
    expect(screen.getByText("fixed-pool")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开原检索评测" })).toHaveAttribute("href", "/projects/demo/explore?evaluation_id=evaluation");
    expect(screen.getByRole("link", { name: "打开基础检索会话" })).toHaveAttribute("href", "/projects/demo/explore?search_id=session");
    expect(screen.getByRole("link", { name: "相关性返工" })).toHaveAttribute("href", "/projects/demo/annotation/tasks/task");
    expect(screen.getByText("验收标注 / 非人工质量结论")).toBeInTheDocument();
    expect(screen.queryByText(/raw-json-must-not-appear/)).not.toBeInTheDocument();
  });
  it("shows natural issue and query context while retaining the actual video asset player", () => {
    context.search = "?sample=sample";
    context.datasets[0].samples = [{ id: "sample", name: "候选镜头", input: JSON.stringify({ schema: "media.failure-candidate.v1", issue: "请确认相关性", query: { mode: "text", query: "森林" }, source: { source_sha256: "raw-source-json" } }), output: "", label: "", state: "待标注", split: "unassigned", assets: [{ id: "asset", kind: "video", playbackUrl: "/api/data-platform/assets/asset/playback", sha256: "a".repeat(64), startMs: 1000, endMs: 2000 }] }];
    const { container } = render(<DatasetDetailPage />);
    expect(screen.getByText("问题：请确认相关性；检索条件：森林")).toBeInTheDocument();
    expect(container.querySelector("video")).toHaveAttribute("src", "/api/data-platform/assets/asset/playback#t=1,2");
    expect(screen.queryByText(/raw-source-json/)).not.toBeInTheDocument();
  });
});
