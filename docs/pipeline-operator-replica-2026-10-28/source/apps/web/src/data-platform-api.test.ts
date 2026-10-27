import { http, HttpResponse, type JsonBodyType } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "./test/server";
import { readPlatformView } from "./data-platform-api";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntitySelect } from "./pages/platform/shared";
vi.mock("./pages/platform/platform-store", () => ({ usePlatform: () => ({ projectId: "demo", state: { datasets: [] } }) }));

const requested: URL[] = [];
type Handler = (url: URL) => unknown;
let handler: Handler;
const page = (items: unknown[] = [], total = items.length, nextCursor: string | null = null) => ({ items, total, nextCursor });
const sample = (id: string) => ({ id, name: `frozen ${id}`, input: `input ${id}`, state: "待标注", revision: 1, split: "train", assets: [] });
const dataset = { id: "dataset", name: "Dataset", sampleCount: 105, pendingCount: 105, latestVersion: null };
const spec = { id: "spec", name: "Spec", labels: ["valid"], instructions: "instructions" };
const task = { id: "task", datasetId: "dataset", specId: "spec", sampleCount: 105, stateCounts: { "已通过": 75, "待标注": 30 } };
const version = { id: "version", datasetId: "dataset", sampleCount: 105, splitCounts: { test: 105 } };
const benchmark = { id: "benchmark", datasetId: "dataset", datasetVersion: "version", sampleCount: 105 };

beforeEach(() => {
  vi.stubEnv("VITE_API_BASE_URL", "http://api.test"); requested.length = 0;
  handler = () => page();
  server.use(http.get("http://api.test/api/data-platform/*", ({ request }) => {
    const url = new URL(request.url); requested.push(url);
    expect(url.searchParams.get("project_id")).toBe("demo");
    expect(url.pathname).not.toBe("/api/data-platform/state");
    return HttpResponse.json(handler(url) as JsonBodyType);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
const path = (url: URL) => url.pathname.replace("/api/data-platform", "");

describe("paged data platform route contracts", () => {
  it("loads a 50 row page while retaining whole catalog counts", async () => {
    handler = url => path(url) === "/datasets" ? page(Array.from({ length: 50 }, (_, i) => ({ ...dataset, id: `dataset-${i}` })), 105, "second") : page();
    const state = await readPlatformView("demo", "/projects/demo/datasets", "?q=rain&modality=视频");
    expect(state.datasets).toHaveLength(50);
    expect(state.page?.total).toBe(105);
    expect(state.catalogs.datasets).toEqual({ total: 105, nextCursor: "second" });
    expect(state.datasets[0].sampleCount).toBe(105);
    expect(state.datasets[0].samples).toEqual([]);
    const query = requested.find(url => path(url) === "/datasets")!;
    expect(query.searchParams.get("q")).toBe("rain");
    expect(query.searchParams.get("modality")).toBe("视频");
  });

  it("fetches an off-page selection through exact task membership, retaining whole task progress", async () => {
    handler = url => {
      const route = path(url);
      if (route === "/tasks/task") return task;
      if (route === "/datasets/dataset") return dataset;
      if (route === "/specs/spec") return spec;
      if (route === "/tasks/task/samples") return url.searchParams.get("sampleId") ? page([sample("off-page")], 1) : page(Array.from({ length: 50 }, (_, i) => sample(String(i))), 105, "next");
      return page();
    };
    const state = await readPlatformView("demo", "/projects/demo/annotation/tasks/task", "?workspace=annotate&sample=off-page");
    expect(state.selectedSample?.id).toBe("off-page");
    expect(state.tasks[0].sampleCount).toBe(105);
    expect(state.tasks[0].stateCounts?.["已通过"]).toBe(75);
    expect(state.tasks[0].sampleIds).toContain("off-page");
    expect(state.page?.total).toBe(105);
    expect(requested.some(url => path(url) === "/samples/off-page")).toBe(false);
    const lookup = requested.find(url => url.searchParams.get("sampleId") === "off-page")!;
    expect(path(lookup)).toBe("/tasks/task/samples");
    expect(lookup.searchParams.get("limit")).toBe("1");
  });

  it("does not substitute a project sample when it is absent from the task", async () => {
    handler = url => {
      if (path(url) === "/tasks/task") return task;
      if (path(url) === "/datasets/dataset") return dataset;
      if (path(url) === "/specs/spec") return spec;
      if (path(url) === "/tasks/task/samples") return url.searchParams.has("sampleId") ? page() : page([sample("member")], 105);
      return page();
    };
    const state = await readPlatformView("demo", "/projects/demo/annotation/tasks/task", "?sample=foreign-to-task");
    expect(state.selectedSample).toBeUndefined();
    expect(state.tasks[0].sampleIds).toEqual(["member"]);
    expect(requested.some(url => path(url).startsWith("/samples/"))).toBe(false);
  });

  it("loads second-page result references from frozen benchmark membership and uses whole aggregates", async () => {
    const aggregates = { count: 105, score: 91, metrics: {} };
    handler = url => {
      const route = path(url);
      if (route === "/experiments/experiment") return { id: "experiment", benchmarkId: "benchmark", aggregates };
      if (route === "/benchmarks/benchmark") return benchmark;
      if (route === "/datasets/dataset") return dataset;
      if (route === "/versions/version") return version;
      if (route === "/experiments/experiment/results") return { ...page([{ sampleId: "61", score: 0 }, { sampleId: "62", score: 100 }], 105, "third"), aggregates };
      if (route === "/benchmarks/benchmark/samples") return page([sample(url.searchParams.get("sampleId")!)], 1);
      return page();
    };
    const state = await readPlatformView("demo", "/projects/demo/evaluations/experiment", "?cursor=second");
    expect(state.experiments[0].results.map(row => row.sampleId)).toEqual(["61", "62"]);
    expect(state.datasets[0].versions[0].samples.map(row => row.id)).toEqual(["61", "62"]);
    expect(state.experiments[0].aggregates?.score).toBe(91);
    expect(state.page?.total).toBe(105);
    expect(requested.find(url => path(url).endsWith("/results"))?.searchParams.get("cursor")).toBe("second");
    expect(requested.filter(url => url.searchParams.has("sampleId")).map(url => path(url))).toEqual(["/benchmarks/benchmark/samples", "/benchmarks/benchmark/samples"]);
  });

  it("routes frozen search and off-page lookups through the selected immutable version", async () => {
    handler = url => {
      const route = path(url);
      if (route === "/datasets/dataset") return dataset;
      if (route === "/datasets/dataset/versions") return page([version]);
      if (route === "/versions/version/samples") return url.searchParams.has("sampleId") ? page([sample("snapshot")], 1) : page([sample("frozen-match")], 105, "next");
      return page();
    };
    const state = await readPlatformView("demo", "/projects/demo/datasets/dataset", "?version=version&q=RAIN&sample=snapshot");
    expect(state.datasets[0].versions[0].samples[0].id).toBe("frozen-match");
    expect(state.selectedSample?.id).toBe("snapshot");
    expect(requested.some(url => path(url) === "/datasets/dataset/samples")).toBe(false);
    const frozenQuery = requested.find(url => path(url) === "/versions/version/samples" && url.searchParams.has("q"))!;
    expect(frozenQuery.searchParams.get("q")).toBe("RAIN");
    expect(requested.find(url => url.searchParams.get("sampleId") === "snapshot")?.pathname).toBe("/api/data-platform/versions/version/samples");
  });

  it("loads off-page experiment evidence without adding rows to the displayed results page", async () => {
    handler = url => {
      const route = path(url);
      if (route === "/experiments/experiment") return { id: "experiment", benchmarkId: "benchmark" };
      if (route === "/benchmarks/benchmark") return benchmark;
      if (route === "/datasets/dataset") return dataset;
      if (route === "/versions/version") return version;
      if (route === "/experiments/experiment/results") return page([{ sampleId: url.searchParams.get("sampleId") ?? "61", score: 90, output: "verified output" }], url.searchParams.has("sampleId") ? 1 : 105);
      if (route === "/benchmarks/benchmark/samples") return page([sample(url.searchParams.get("sampleId")!)], 1);
      return page();
    };
    const state = await readPlatformView("demo", "/projects/demo/evaluations/experiment", "?sample=off-page");
    expect(state.experiments[0].results.map(item => item.sampleId)).toEqual(["61"]);
    expect(state.selectedSample?.id).toBe("off-page");
    expect(state.selectedResult).toMatchObject({ sampleId: "off-page", output: "verified output" });
    expect(state.page?.total).toBe(105);
  });

  it("hydrates feedback from immutable benchmark membership rather than the mutated working copy", async () => {
    handler = url => {
      const route = path(url);
      if (route === "/feedback/feedback") return { id: "feedback", datasetId: "dataset", sampleId: "off-page", experimentId: "experiment" };
      if (route === "/experiments/experiment") return { id: "experiment", benchmarkId: "benchmark" };
      if (route === "/benchmarks/benchmark") return benchmark;
      if (route === "/datasets/dataset") return dataset;
      if (route === "/versions/version") return version;
      if (route === "/samples/off-page") return { ...sample("off-page"), input: "mutated working input" };
      if (route === "/benchmarks/benchmark/samples") return page([sample("off-page")]);
      if (route === "/experiments/experiment/results") return page([{ sampleId: "off-page", score: 90, output: "original model output" }]);
      return page();
    };
    const state = await readPlatformView("demo", "/projects/demo/feedback/feedback", "");
    expect(state.datasets[0].samples[0].input).toBe("mutated working input");
    expect(state.datasets[0].versions[0].samples[0].input).toBe("input off-page");
    expect(state.experiments[0].results[0].output).toBe("original model output");
    expect(requested.find(url => path(url).endsWith("/results"))?.searchParams.get("sampleId")).toBe("off-page");
  });

  it("a catalog selector can reach entities beyond the loaded catalog and retain an off-page selected option", async () => {
    handler = url => path(url) === "/datasets" ? (url.searchParams.get("cursor") === "second"
      ? page([{ id: "dataset-61", name: "Second page entity" }], 105)
      : page([{ id: "dataset-1", name: "First page entity" }], 105, "second")) : page();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client }, createElement(EntitySelect, {
      resource: "datasets", value: "outside", onChange: vi.fn(), label: "输入数据集", selected: { id: "outside", name: "Retained selected entity" },
    })));
    await screen.findByRole("option", { name: "First page entity" });
    expect(screen.getByRole("option", { name: "Retained selected entity" })).toBeInTheDocument();
    expect(screen.getByText("共 105 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "后一页" }));
    await screen.findByRole("option", { name: "Second page entity" });
    expect(screen.getByRole("option", { name: "Retained selected entity" })).toBeInTheDocument();
    expect(requested.some(url => url.searchParams.get("cursor") === "second")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "搜索输入数据集" }), { target: { value: "rare entity" } });
    await waitFor(() => expect(requested.some(url => url.searchParams.get("q") === "rare entity" && !url.searchParams.has("cursor"))).toBe(true));
    client.clear();
  });
});
