import { createContext, createElement, useContext, useDeferredValue, type ReactNode } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useProjectAuth } from "../../auth-context";
import { platformStateQuery, platformRequest } from "../../data-platform-api";

export type SampleState = "待标注" | "待审核" | "已通过" | "需修订";
export interface Asset {id:string;kind:"video"|"image"|"audio"|"pointcloud"|"text";uri?:string;videoId?:string;shotId?:string;sha256:string;startMs?:number;endMs?:number;mimeType?:string;playbackUrl:string;metadata?:Record<string,unknown>}
export interface PageInfo {items?:undefined;total:number;nextCursor:string|null;resource:string;limit?:number}
export interface Sample { assets?: Asset[]; id: string; name: string; input: string; output: string; label: string; state: SampleState; split: string; annotationId?: string; geometry?: Record<string, unknown>; revision: number }
export interface DatasetVersion {qualityProfile?:string; id: string; description: string; samples: Sample[]; created: string; version: string; qualityReport: Record<string, unknown>; sampleCount?:number;splitCounts?:Record<string,number>;datasetId?:string; }
export interface Dataset {pipelineSource?: {run_id:string;artifact_id:string;content_hash:string;mapping_version:string;mapping_digest?:string};sampleCount?:number;pendingCount?:number;stateCounts?:Record<string,number>;qualityProfile?:string;latestVersion?:DatasetVersion;versionCount?:number; id: string; name: string; modality: string; purpose: string; source: string; samples: Sample[]; versions: DatasetVersion[]; revision: number }
export interface Spec {taskCount?:number; id: string; name: string; type: string; version: string; labels: string[]; instructions: string; revision: number }
export interface Task {sampleCount?:number;stateCounts?:Record<string,number>; id: string; name: string; datasetId: string; sampleIds: string[]; specId: string; specVersion: string; assignee: string; reviewer: string; feedbackId?: string; revision: number }
export interface Benchmark {sampleCount?:number; id: string; name: string; datasetId: string; datasetVersion: string; version: string; metric: string; rule: string; sampleIds: string[]; scorer: string; revision: number }
export interface Result { sampleId: string; score: number; output: string; note: string; revision: number }
export interface Experiment {aggregates?:{count:number;score:number|null;metrics:Record<string,unknown>}; id: string; name: string; benchmarkId: string; model: string; team: string; member: string; status: "待执行" | "执行中" | "已完成" | "阻塞" | "执行失败"; executionError?: string; results: Result[]; revision: number }
export interface Feedback { id: string; title: string; datasetId: string; sampleId: string; experimentId?: string; status: "待处理" | "处理中" | "已验证"; evidence: string; records: string[]; selectionId?: string; taskId?: string; input?: string; output?: string; revision: number }
export interface Selection {sampleCount?:number; id: string; name: string; datasetId: string; datasetVersion?: string; sampleIds: string[]; feedbackId: string; revision: number }
export interface TrainingRun {id:string;name:string;datasetVersionId:string;modelId?:string;externalRef:string;config:Record<string,unknown>;codeRevision:string;image:string;sampleIds:string[]}
export interface PlatformState {page?:PageInfo;versionPage?:PageInfo;selectedSample?:Sample;selectedResult?:Result;catalogs:Record<string,{total:number;nextCursor:string|null}>; datasets: Dataset[]; specs: Spec[]; tasks: Task[]; benchmarks: Benchmark[]; experiments: Experiment[]; feedback: Feedback[]; selections: Selection[]; users: {id:string;name:string;canAnnotate:boolean;canReview:boolean}[]; trainingRuns: TrainingRun[]; models: {id:string;name:string;version:string}[]; revision: number }


const PlatformContext = createContext<ReturnType<typeof usePlatformData> | null>(null);

/** One deferred query owner keeps newly opened panels from suspending the whole page. */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const platform = usePlatformData();
  return createElement(PlatformContext.Provider, { value: platform }, children);
}

export function usePlatform() {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error("Platform resources must be rendered inside PlatformProvider");
  return platform;
}

function usePlatformData() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({select: (state) => state.location.searchStr});
  const deferredSearch=useDeferredValue(search);
  const projectId = decodeURIComponent(pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? "demo");
  const { me, can } = useProjectAuth(projectId);
  const client = useQueryClient();
  const { data: state } = useSuspenseQuery(platformStateQuery(projectId, me.user.id,pathname,deferredSearch));
  async function refreshAfterWrite() {
    const filters = { queryKey: ["data-platform", projectId] };
    // A deferred URL can be fetching its first snapshot without a committed
    // observer. Invalidation alone can reuse that pre-write request, which then
    // clears the invalidated flag and hides the successfully persisted change.
    await client.cancelQueries(filters);
    await client.invalidateQueries(filters);
  }
  async function write<T extends { id?: string } = { id: string }>(endpoint: string, body: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
    try {
      const result = await platformRequest<T>(projectId, endpoint+(endpoint.includes("?")?"&":"?")+"summaryOnly=true", me.csrf_token, body, method);
      await refreshAfterWrite();
      return result;
    } catch (error) {
      // Refresh concurrent changes, while component inputs remain mounted.
      await refreshAfterWrite();
      throw error;
    }
  }
  return { state, write, projectId, can, userId: me.user.id,
    userName: (id: string) => state.users.find((item) => item.id === id)?.name ?? id,
    path: (suffix: string) => `/projects/${encodeURIComponent(projectId)}/${suffix}`,
    id: decodeURIComponent(pathname.split("/").at(-1) ?? "") };
}
export const score = (experiment: Experiment) => experiment.aggregates ? (experiment.aggregates.score == null ? "—" : experiment.aggregates.score.toFixed(1)) : experiment.results.length ? (experiment.results.reduce((total, row) => total + row.score, 0) / experiment.results.length).toFixed(1) : "—";
export function taskSamples(state: PlatformState, task: Task) { return state.datasets.find((item) => item.id === task.datasetId)?.samples.filter((item) => task.sampleIds.includes(item.id)) ?? []; }
export function taskStatus(samples: Sample[]) { return samples.length && samples.every((item) => item.state === "已通过") ? "已完成" : samples.some((item) => item.state === "需修订") ? "需修订" : samples.some((item) => item.state === "待标注") ? "标注中" : "待审核"; }

export function taskSummaryStatus(task:Task) {const counts=task.stateCounts;if(!counts)return "待审核";return task.sampleCount && counts["已通过"]===task.sampleCount ? "已完成" : counts["需修订"] ? "需修订" : counts["待标注"] ? "标注中" : "待审核";}
