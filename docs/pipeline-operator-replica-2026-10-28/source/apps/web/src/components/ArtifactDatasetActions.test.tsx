import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { ArtifactDatasetActions } from "./ArtifactDatasetActions";

vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ me: { csrf_token: "csrf-a" }, can: (key: string) => key === "data_platform:write" }) }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children, params }: { children: React.ReactNode; params: { projectId: string; datasetId: string } }) => <a href={`/projects/${params.projectId}/datasets/${params.datasetId}`}>{children}</a> }));
function mount(debug: boolean, succeeded = true, recordCount = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><ArtifactDatasetActions projectId="project-a" artifactId="artifact-a" nodeId="filter" debug={debug} succeeded={succeeded} recordCount={recordCount} /></QueryClientProvider>);
  return client;
}
beforeEach(() => { vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
describe("artifact to candidate dataset", () => {
  it("prevents publishing debug artifacts and incomplete production runs", () => {
    const first = mount(true); expect(screen.getByText(/调试产物仅用于检查/)).toBeVisible(); expect(screen.queryByRole("button", { name: "导入候选数据集" })).not.toBeInTheDocument(); first.clear(); cleanup();
    const second = mount(false, false); expect(screen.getByText(/正式运行成功后/)).toBeVisible(); expect(screen.queryByRole("button", { name: "导入候选数据集" })).not.toBeInTheDocument(); second.clear();
  });
  it("blocks oversized complete artifacts rather than importing only their preview", () => {
    const client = mount(false, true, 1001); expect(screen.getByText(/同步导入最多支持 1,000 条记录；此产物有 1,001 条/)).toBeVisible(); expect(screen.queryByRole("button", { name: "导入候选数据集" })).not.toBeInTheDocument(); client.clear();
  });
  it("reports successful candidate import with unresolved quality gates and links the existing publishing UI", async () => {
    server.use(http.post("http://api.test/api/pipeline-artifacts/artifact-a/dataset", async ({ request }) => {
      expect(new URL(request.url).searchParams.get("project_id")).toBe("project-a");
      expect(request.headers.get("x-csrf-token")).toBe("csrf-a");
      expect(await request.json()).toEqual({ name: "filter 候选数据集" });
      return HttpResponse.json({ dataset_id: "dataset-a", created: true, source: {}, quality_report: { passed: false, issues: [{ message: "样本需要划分与审核" }] } });
    }));
    const client = mount(false); fireEvent.click(screen.getByRole("button", { name: "导入候选数据集" }));
    await screen.findByRole("status"); expect(screen.getByRole("status")).toHaveTextContent("已导入候选数据集");
    expect(screen.getByText("样本需要划分与审核")).toBeVisible(); expect(screen.getByRole("link", { name: /查看质量并发布/ })).toHaveAttribute("href", "/projects/project-a/datasets/dataset-a");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); client.clear();
  });
  it("retries an uncertain import with the original name and derived server identity", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("http://api.test/api/pipeline-artifacts/artifact-a/dataset", async ({ request }) => {
      bodies.push(await request.json()); return HttpResponse.json({ detail: "暂时无法导入" }, { status: 503 });
    }));
    const client = mount(false); fireEvent.click(screen.getByRole("button", { name: "导入候选数据集" }));
    await screen.findByRole("alert"); expect(screen.getByRole("textbox", { name: "候选数据集名称" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "导入候选数据集" })); await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1]).toEqual(bodies[0]); client.clear();
  });

  it("uses the same derived identity after a fresh page visit and permits a different named candidate", async () => {
    const bodies: unknown[] = [];
    server.use(http.post("http://api.test/api/pipeline-artifacts/artifact-a/dataset", async ({ request }) => {
      const body = await request.json(); bodies.push(body);
      return HttpResponse.json({ dataset_id: "dataset-a", created: bodies.length === 1, source: {}, quality_report: { passed: false, issues: [] } });
    }));
    const first = mount(false); fireEvent.click(screen.getByRole("button", { name: "导入候选数据集" })); await screen.findByRole("status"); first.clear(); cleanup();
    // Even without browser storage the same artifact/name request has no random identity.
    sessionStorage.clear();
    const second = mount(false); fireEvent.click(screen.getByRole("button", { name: "导入候选数据集" })); await screen.findByRole("status");
    expect(screen.getByRole("status")).toHaveTextContent("已找到此前导入的候选数据集"); expect(bodies[1]).toEqual(bodies[0]);
    fireEvent.click(screen.getByRole("button", { name: "导入另一个候选" })); fireEvent.change(await screen.findByRole("textbox", { name: "候选数据集名称" }), { target: { value: "第二个候选" } });
    fireEvent.click(screen.getByRole("button", { name: "导入候选数据集" })); await waitFor(() => expect(bodies).toHaveLength(3)); expect(bodies[2]).toEqual({ name: "第二个候选" }); second.clear();
  });
});
