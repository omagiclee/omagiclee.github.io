import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { DatasetQualityPanel } from "./DatasetQualityPanel";
beforeEach(() => vi.stubEnv("VITE_API_BASE_URL", "http://api.test"));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
it("queries the exact project working revision and never presents the previous dataset report during a switch", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  server.use(http.get("http://api.test/api/data-platform/datasets/:id/quality", async ({ request, params }) => {
    expect(new URL(request.url).searchParams.get("project_id")).toBe("project-a");
    if (params.id === "second") { await gate; return HttpResponse.json({ passed: true, sampleCount: 3, issueCount: 0, issues: [] }); }
    return HttpResponse.json({ passed: false, sampleCount: 2, issueCount: 1, issues: [{ rule: "assigned_split", message: "来源样本尚未划分", sampleIds: ["sample-1"] }] });
  }));
  const client = new QueryClient();
  const content = (datasetId: string) => <QueryClientProvider client={client}><DatasetQualityPanel projectId="project-a" datasetId={datasetId} revision={1} /></QueryClientProvider>;
  const view = render(content("first")); await screen.findByText("来源样本尚未划分 · sample-1");
  view.rerender(content("second"));
  expect(screen.getByRole("status")).toHaveTextContent("正在检查整个工作副本");
  expect(screen.queryByText("来源样本尚未划分 · sample-1")).not.toBeInTheDocument();
  release(); await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("质量检查通过")); client.clear();
});
