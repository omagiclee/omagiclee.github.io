import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoGtPublishedExport } from "./AutoGtPublishedExport";
import { server } from "../test/server";
vi.mock("../auth-context", () => ({ useProjectAuth: () => ({ can: () => true }) }));
const plan = { eligible: true, dataset_id: "dataset", version_id: "published", sample_count: 12, split_counts: { train: 8, validation: 2, test: 2 }, group_counts: { train: 4, validation: 1, test: 1 }, asset_count: 24, manifest_sha256: "a".repeat(64), estimated_bytes: 2048 };
const clients: QueryClient[] = []; function mount(versionId = "published") { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); render(<QueryClientProvider client={client}><AutoGtPublishedExport projectId="demo" datasetId="dataset" versionId={versionId} datasetName="配对集" versionName="v1" /></QueryClientProvider>); }
beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", "http://api.test")); afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("only frozen published paired versions export real split files", () => {
  it("preflights actual counts before enabling a real ZIP and keeps a failed export retryable", async () => {
    let failed = true; const OriginalURL = URL; const createObjectURL = vi.fn(() => "blob:published"); vi.stubGlobal("URL", class extends OriginalURL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn(); }); const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    server.use(http.get("http://api.test/api/auto-gt/datasets/dataset/versions/published/export-plan", ({ request }) => { expect(new URL(request.url).searchParams.get("project_id")).toBe("demo"); return HttpResponse.json(plan); }), http.get("http://api.test/api/auto-gt/datasets/dataset/versions/published/archive", () => failed ? HttpResponse.json({ detail: "目标文件已漂移" }, { status: 409 }) : new HttpResponse(new Uint8Array([80, 75, 3, 4]), { headers: { "Content-Type": "application/zip" } })));
    mount(); expect(screen.getByRole("button", { name: "下载正式版本分组 ZIP" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "预检正式版本文件" })); await screen.findByRole("table", { name: "实际已发布分组" }); expect(screen.getByText("train/")).toBeInTheDocument(); expect(screen.getByText("当前正式版本满足导出门禁 · 12 个样本 · 24 个资产")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载正式版本分组 ZIP" })); expect(await screen.findByRole("alert")).toHaveTextContent("目标文件已漂移"); expect(click).not.toHaveBeenCalled(); failed = false; await waitFor(() => expect(screen.getByRole("button", { name: "下载正式版本分组 ZIP" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "下载正式版本分组 ZIP" })); await waitFor(() => expect(click).toHaveBeenCalledOnce()); expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("配对集-v1.zip");
  });
  it("blocks working copies and reports missing or unassigned source gates rather than inventing empty groups", async () => {
    mount("working"); expect(screen.getByRole("button", { name: "预检正式版本文件" })).toBeDisabled(); cleanup(); clients.forEach((client) => client.clear());
    server.use(http.get("http://api.test/api/auto-gt/datasets/dataset/versions/published/export-plan", () => HttpResponse.json({ detail: "存在未划分样本或未通过独立审核" }, { status: 422 })));
    mount(); fireEvent.click(screen.getByRole("button", { name: "预检正式版本文件" })); expect(await screen.findByRole("alert")).toHaveTextContent("存在未划分样本或未通过独立审核"); expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "下载正式版本分组 ZIP" })).toBeDisabled();
  });
});
