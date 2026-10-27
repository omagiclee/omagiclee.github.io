import { http, HttpResponse } from "msw";
import type { DashboardData, EventCreateInput, FlywheelEvent } from "../types";

export const dashboardFixture: DashboardData = {
  project_id: "demo",
  generated_at: "2026-09-05T09:43:00Z",
  stages: [
    { key: "ingest", name: "采集", status: "running", count: 128400, detail: "12 个活跃数据源" },
    { key: "label", name: "标注", status: "running", count: 18620, detail: "3 个标注队列" },
    { key: "train", name: "训练", status: "running", count: 7, detail: "2 个任务运行中" },
    { key: "evaluate", name: "评估", status: "attention", count: 14, detail: "1 个指标待确认" },
    { key: "ship", name: "发布", status: "healthy", count: 23, detail: "最近发布于 10:42" },
    { key: "observe", name: "观测", status: "healthy", count: 96, detail: "全部监控正常" },
  ],
  metrics: [
    { key: "quality", label: "模型质量", value: "91.6%", change: "+2.1%", trend: "up" },
  ],
  events: [
    { id: "evt-test", project_id: "demo", stage: "ingest", title: "测试数据入湖", source: "msw", volume: 100, created_at: "2026-09-05T09:40:00Z" },
  ],
  experiments: [
    { id: "exp-test", name: "测试实验", owner: "数据平台组", status: "running", progress: 50, target: "质量 +1%" },
  ],
};

export const handlers = [
  http.get("*/api/flywheel", () => HttpResponse.json(dashboardFixture)),
  http.post("*/api/events", async ({ request }) => {
    const payload = await request.json() as EventCreateInput;
    const event: FlywheelEvent = {
      id: "evt-created",
      project_id: "demo",
      created_at: new Date().toISOString(),
      ...payload,
    };
    return HttpResponse.json(event, { status: 201 });
  }),
];
