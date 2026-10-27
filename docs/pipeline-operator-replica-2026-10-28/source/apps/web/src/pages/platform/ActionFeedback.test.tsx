import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../../test/server";
import { DatasetDetailPage } from "./DatasetPages";
import { EvaluationExperimentDetailPage } from "./EvaluationPages";
import { ModelReleasePanel, TrainingLifecyclePanel } from "./ExecutionPanels";

const context = vi.hoisted(() => ({ id: "dataset", search: "", write: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
 useRouterState: ({select}: {select: (state: unknown)=>unknown}) => select({location: {pathname: `/projects/demo/datasets/${context.id}`, searchStr: context.search}}),
 useNavigate: () => vi.fn(),
 Link: ({children, to}: {children: React.ReactNode; to: string}) => <a href={to}>{children}</a>,
}));
vi.mock("../../auth-context", () => ({useProjectAuth: () => ({me: {csrf_token: "csrf"}, can: () => true})}));
vi.mock("./platform-store", () => ({usePlatform: () => ({
 id: context.id, projectId: "demo", userId: "owner", can: () => true, userName: () => "模型评测组", write: context.write, path: (value: string) => `/projects/demo/${value}`,
 state: {
  datasets: [{id: "dataset", name: "固定文本数据", modality: "文本", purpose: "评测", revision: 1, samples: [], versions: [{id: "version", version: "v1", samples: [], splitCounts: {}}]}],
  benchmarks: [{id: "benchmark", name: "固定基准", datasetId: "dataset", datasetVersion: "version", sampleIds: [], sampleCount: 0, metric: "得分"}],
  experiments: [{id: "experiment", name: "评测失败重试", benchmarkId: "benchmark", model: "模型v1", status: "待执行", results: [], revision: 1}],
  tasks: [], selections: [], trainingRuns: [], models: [], users: [], feedback: [],
 },
})}));
const clients: QueryClient[] = [];
function mount(element: React.ReactNode) { const client = new QueryClient({defaultOptions:{queries:{retry:false}}}); clients.push(client); render(<QueryClientProvider client={client}>{element}</QueryClientProvider>); }
beforeEach(() => {
 context.id = "dataset"; context.search = ""; context.write.mockReset(); vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
 server.use(
  http.get("http://api.test/api/data-platform/execution/training-jobs", () => HttpResponse.json({items: [{id: "job", name: "外部训练", status: "pending", revision: 1, externalRef: "external-1"}], nextCursor: null})),
  http.get("http://api.test/api/data-platform/execution/releases", () => HttpResponse.json([{id: "release", channel: "production", number: 2, previousId: "previous", modelId: "model", experimentId: "experiment"}])),
  http.get("http://api.test/api/data-platform/execution/experiments/experiment/report", () => HttpResponse.json({source: "manual-unverified", sampleCount: 0, metrics: {}, checks: []})),
 );
});
afterEach(() => { cleanup(); clients.forEach(client=>client.clear()); clients.length = 0; vi.unstubAllEnvs(); });

it("announces a failed external training submission and clears it on successful retry", async () => {
 context.write.mockRejectedValueOnce(new Error("训练适配器不可用")).mockResolvedValueOnce({});
 mount(<TrainingLifecyclePanel datasetId="dataset" versions={[]} />);
 fireEvent.click(await screen.findByRole("button", {name: "提交外部训练"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("训练适配器不可用");
 await waitFor(()=>expect(screen.getByRole("button", {name: "提交外部训练"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button", {name: "提交外部训练"}));
 expect(await screen.findByText(/外部训练提交意图已保存/)).toHaveAttribute("role", "status");
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("keeps a failed model rollback visible and announces a successful retry separately", async () => {
 context.write.mockRejectedValueOnce(new Error("上一模型对象校验失败")).mockResolvedValueOnce({});
 mount(<ModelReleasePanel />);
 await waitFor(()=>expect(screen.getByRole("button", {name: "回滚上一版本"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button", {name: "回滚上一版本"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("上一模型对象校验失败");
 await waitFor(()=>expect(screen.getByRole("button", {name: "回滚上一版本"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button", {name: "回滚上一版本"}));
 expect(await screen.findByText(/通道已回滚到上一已验证模型/)).toHaveAttribute("role", "status");
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("does not style a failed dataset split preview as a successful informational message", async () => {
 context.search = `?tab=${encodeURIComponent("血缘与使用")}`;
 const plan = {datasetId:"dataset",revision:1,seed:"42",ratios:{train:0,validation:.5,test:.5},counts:{train:0,validation:1,test:1},groupCounts:{train:0,validation:1,test:1},groups:[],assignments:{},planDigest:"a".repeat(64),note:"小池实际比例以完整来源组为准"};
 context.write.mockRejectedValueOnce(new Error("样本版本冲突")).mockResolvedValueOnce(plan).mockResolvedValueOnce({plan,revision:2});
 mount(<DatasetDetailPage />);
 fireEvent.click(screen.getByRole("button", {name: "预览同源分组划分"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("样本版本冲突");
 fireEvent.click(screen.getByRole("button", {name: "预览同源分组划分"}));
 await screen.findByRole("button", {name:"确认应用此分组计划"});
 fireEvent.click(screen.getByRole("button", {name:"确认应用此分组计划"}));
 expect(await screen.findByText(/已应用预览中的同源分组计划/)).toHaveAttribute("role", "status");
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("announces an evaluation execution rejection using error semantics", async () => {
 context.id = "experiment"; context.write.mockRejectedValueOnce(new Error("模型服务认证失败"));
 mount(<EvaluationExperimentDetailPage />);
 fireEvent.click(screen.getByRole("button", {name: "执行模型评测"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("模型服务认证失败");
});
