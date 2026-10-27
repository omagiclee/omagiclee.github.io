import { interactionForEvent } from "../telemetry";
import { useMemo, useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Check, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { eventsQueryOptions, exportEvents } from "../api";
import { Can, useAuth } from "../auth-context";
import { EventForm } from "../components/EventForm";
import { PermissionRequestButton } from "../components/PermissionRequestButton";
import { gridLocaleZhCN, gridTheme } from "../components/ui/grid-theme";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { FlywheelEvent, StageKey } from "../types";
import "./events.css";

ModuleRegistry.registerModules([AllCommunityModule]);

const stageLabels: Record<StageKey, string> = {
  ingest: "采集",
  label: "标注",
  train: "训练",
  evaluate: "评估",
  ship: "发布",
  observe: "观测",
};



function EventsContent({ csrfToken }: { csrfToken: string }) {
  const query = useSuspenseQuery(eventsQueryOptions);
  const [stage, setStage] = useState<"all" | StageKey>("all");
  const events = stage === "all" ? query.data : query.data.filter((event) => event.stage === stage);
  const exportMutation = useMutation({
    mutationFn: exportEvents,
    onSuccess: (records) => {
      const selected = stage === "all" ? records : records.filter((event) => event.stage === stage);
      const url = URL.createObjectURL(new Blob([JSON.stringify(selected, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `data-events-${stage}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const columns = useMemo<ColDef<FlywheelEvent>[]>(() => [
    {
      field: "stage",
      headerName: "阶段",
      minWidth: 96,
      maxWidth: 128,
      valueFormatter: ({ data }) => data ? stageLabels[data.stage] : "-",
      filter: true,
    },
    { field: "title", headerName: "事件", minWidth: 220, flex: 1.4, filter: true },
    { field: "source", headerName: "数据源", minWidth: 160, flex: 1, filter: true },
    {
      field: "volume",
      headerName: "数据量",
      minWidth: 120,
      type: "numericColumn",
      valueFormatter: ({ data }) => data ? data.volume.toLocaleString("zh-CN") : "-",
    },
    {
      field: "created_at",
      headerName: "发生时间",
      minWidth: 168,
      valueFormatter: ({ data }) => data
        ? new Date(data.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "-",
    },
  ], []);

  const defaultColumn = useMemo<ColDef<FlywheelEvent>>(() => ({
    sortable: true,
    resizable: true,
    autoHeight: true,
    wrapText: true,
    autoHeaderHeight: true,
    wrapHeaderText: true,
    suppressHeaderMenuButton: false,
  }), []);

  return (
    <main className="md-page space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="md-page-title">数据事件</h1>
          <p className="md-body-medium mt-1 text-muted-foreground">查看数据来源、飞轮阶段与事件记录。</p>
        </div>
        <div className="flex items-center gap-2">
          <Can permission="events:export" fallback={<PermissionRequestButton permission="events:export" label="申请导出权限" />}>
            <Button variant="outline" data-track-id="events.export" data-track-label="导出数据事件" onClick={(event) => exportMutation.mutate(interactionForEvent(event.nativeEvent))} disabled={exportMutation.isPending}>
              {exportMutation.isPending ? <LoaderCircle className="animate-spin" /> : <Download />}导出事件
            </Button>
          </Can>
          <Button variant="ghost" size="icon" data-track-id="events.refresh" data-track-label="刷新数据事件" onClick={() => void query.refetch()} disabled={query.isFetching} title="刷新事件" aria-label="刷新事件">
            <RefreshCw className={cn(query.isFetching && "animate-spin")} />
          </Button>
        </div>
      </section>
      {exportMutation.isError && <p className="md-body-small text-destructive" role="alert">{exportMutation.error.message}</p>}

      <Can permission="events:create" fallback={<PermissionRequestButton permission="events:create" label="申请录入事件权限" />}>
        <details className="events-entry"><summary>录入事件</summary><EventForm csrfToken={csrfToken} /></details>
      </Can>

      <section aria-labelledby="events-grid-heading">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="events-grid-heading" className="md-title-large">事件流水</h2>
            <p className="md-body-medium mt-1 text-muted-foreground">{events.length} 条当前事件</p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="按飞轮阶段筛选">
            <button type="button" className="md-filter-chip md-state-layer" aria-pressed={stage === "all"} data-track-id="events.stage.all" data-track-label="查看全部阶段" onClick={() => setStage("all")}>
              <span className="md-chip-container md-state-layer">{stage === "all" && <Check className="size-[18px]" aria-hidden="true" />}全部</span>
            </button>
            {(Object.entries(stageLabels) as [StageKey, string][]).map(([key, name]) => (
              <button type="button" key={key} className="md-filter-chip md-state-layer" aria-pressed={stage === key} data-track-id={`events.stage.${key}`} data-track-label={name} onClick={() => setStage(key)}>
                <span className="md-chip-container md-state-layer">{stage === key && <Check className="size-[18px]" aria-hidden="true" />}{name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="md-grid-shell w-full">
          <AgGridReact<FlywheelEvent>
            theme={gridTheme}
            localeText={gridLocaleZhCN}
            rowData={events}
            columnDefs={columns}
            defaultColDef={defaultColumn}
            domLayout="autoHeight"
            getRowId={({ data }) => data.id}
            headerHeight={40}
            rowHeight={44}
            pagination={events.length > 10}
            paginationPageSize={10}
            paginationPageSizeSelector={[10, 20, 50]}
            animateRows
          />
        </div>
      </section>
    </main>
  );
}

export default function EventsPage() {
  const { me, can } = useAuth();
  if (!can("events:read")) {
    return <main className="md-page"><h1 className="md-page-title">无权访问</h1><p className="md-body-medium mt-2 text-muted-foreground">当前身份没有查看数据事件的权限。</p><PermissionRequestButton permission="events:read" label="申请查看事件权限" className="mt-4" /></main>;
  }
  return <EventsContent csrfToken={me.csrf_token} />;
}
