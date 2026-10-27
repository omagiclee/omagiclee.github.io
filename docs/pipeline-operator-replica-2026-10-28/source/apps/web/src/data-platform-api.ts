import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch } from "./telemetry";
import type { PlatformState } from "./pages/platform/platform-store";

export function platformUrl(project: string, endpoint: string) {
  return apiUrl(`/api/data-platform${endpoint}${endpoint.includes("?") ? "&" : "?"}project_id=${encodeURIComponent(project)}`);
}
export async function platformRequest<T>(project: string, endpoint: string, csrf?: string, body?: unknown, method: "POST" | "PUT" = "POST"): Promise<T> {
  const response = await instrumentedFetch(platformUrl(project, endpoint), { credentials: "include",
    ...(body !== undefined ? {method, headers: {"Content-Type":"application/json", "X-CSRF-Token":csrf ?? ""}, body:JSON.stringify(body)} : {}) });
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try { const data = await response.json() as {detail?:unknown};
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item) => item.msg ?? "参数无效").join("；");
      else if (data.detail && typeof data.detail === "object" && "message" in data.detail) {message = String(data.detail.message); const report=(data.detail as {qualityReport?:{issues?:{message?:string;code?:string}[]}}).qualityReport;if(report?.issues?.length) message += "："+report.issues.slice(0,10).map(item=>item.message??item.code).join("；");}
    } catch { /* Retain transport error. */ }
    throw new ApiError(response.status === 409 ? `${message}。已刷新最新记录，请核对后重试；未保存输入仍保留。` : message, response.status);
  }
  return response.json() as Promise<T>;
}
export interface PageResult<T> { items: T[]; total: number; nextCursor: string | null; limit?: number }
export const platformPageQuery = <T>(project: string, endpoint: string) => queryOptions({
  queryKey: ["data-platform", project, "page", endpoint], queryFn: () => platformRequest<PageResult<T>>(project, endpoint), staleTime: 10_000,
});

const resources = {datasets:"datasets",specs:"specs",tasks:"tasks",benchmarks:"benchmarks",experiments:"experiments",feedback:"feedback",selections:"selections",trainingRuns:"training-runs",models:"models"} as const;
type Resource = keyof typeof resources;
function normalized(resource: Resource, row: any) {
  if (resource === "datasets") return {...row, samples: row.samples ?? [], versions: row.versions ?? (row.latestVersion ? [{...row.latestVersion,samples:[]}] : [])};
  if (resource === "experiments") return {...row,results:row.results ?? []};
  if (["tasks","benchmarks","selections","trainingRuns"].includes(resource)) return {...row,sampleIds:row.sampleIds ?? []};
  return row;
}
// Summaries and membership pages are separate: counts and scores describe the whole
// entity even when only one page of members is loaded.
export async function readPlatformView(project: string, pathname: string, search: string): Promise<PlatformState> {
  const tail = pathname.replace(/^\/projects\/[^/]+\//, "").split("/");
  const route = tail[0] === "annotation" ? tail[1] : tail[0] === "evaluations" ? "experiments" : tail[0];
  const primary = (Object.keys(resources).includes(route) ? route : "datasets") as Resource;
  const entityId = decodeURIComponent(tail[tail[0] === "annotation" ? 2 : 1] ?? "");
  const params = new URLSearchParams(search);
  const qs = (cursor = false) => { const p = new URLSearchParams({limit:"50"}); if (cursor && params.get("cursor")) p.set("cursor",params.get("cursor")!); if (cursor && params.get("q")) p.set("q",params.get("q")!); return p; };
  const state = {revision:1,catalogs:{}} as unknown as PlatformState;
  await Promise.all((Object.entries(resources) as [Resource,string][]).map(async ([key,endpoint]) => {
    const p = qs(!entityId && key === primary);
    if(!entityId && key===primary) for(const filter of ["modality","status","benchmarkId"]) if(params.get(filter)) p.set(filter,params.get(filter)!);
    if(entityId && primary==="specs" && key==="tasks") p.set("specId",entityId);
    if (entityId && primary === "datasets" && ["tasks","benchmarks","feedback","selections","experiments"].includes(key)) p.set("datasetId",entityId);
    const page = await platformRequest<PageResult<any>>(project,`/${endpoint}?${p}`);
    (state as any)[key] = page.items.map(row => normalized(key,row));
    state.catalogs[key] = {total:page.total,nextCursor:page.nextCursor};
    if (!entityId && key === primary) state.page = {...page,items:undefined,resource:key};
  }));
  const users = await platformRequest<PageResult<PlatformState["users"][number]>>(project,"/users"); state.users=users.items;
  const merge = (key:Resource,row:any) => { const rows=(state as any)[key] as any[]; const index=rows.findIndex(item=>item.id===row.id); const value=normalized(key,{...(index<0?{}:rows[index]),...row}); if(index<0) rows.push(value); else rows[index]=value; return value; };
  const detail = async (key:Resource,id:string) => {
    const existing = (state as any)[key].find((item:any)=>item.id===id);
    if (existing) return existing;
    return merge(key,await platformRequest<any>(project,`/${resources[key]}/${encodeURIComponent(id)}`));
  };
  const members = async (endpoint:string) => {
    const page=await platformRequest<PageResult<any>>(project,`${endpoint}?${qs(true)}`);
    state.page={...page,items:undefined,resource:"members"};
    const sampleId=params.get("sample");
    if(sampleId && !page.items.some(item=>item.id===sampleId)) {
      const selected=await platformRequest<PageResult<any>>(project,`${endpoint}?limit=1&sampleId=${encodeURIComponent(sampleId)}`);
      state.selectedSample=selected.items[0];
    } else state.selectedSample=page.items.find(item=>item.id===sampleId);
    return page.items;
  };
  if(entityId) {
    const current=merge(primary,await platformRequest<any>(project,`/${resources[primary]}/${encodeURIComponent(entityId)}`));
    if(primary === "datasets") {
      const versions = await platformRequest<PageResult<any>>(project,`/datasets/${entityId}/versions?${qs(params.get("tab")==="版本")}`);
      current.versions=versions.items.map(item=>({...item,samples:[]}));
      state.versionPage={...versions,items:undefined,resource:"versions"};
      const version=params.get("version"); const selection=params.get("selection");
      let endpoint=`/datasets/${entityId}/samples`;
      if (version && version!=="working") {
        let frozen=current.versions.find((item:any)=>item.id===version);
        if(!frozen) {frozen={...await platformRequest<any>(project,`/versions/${encodeURIComponent(version)}`),samples:[]};if(frozen.datasetId!==entityId) throw new ApiError("数据版本不属于当前数据集",404);current.versions.push(frozen);}
        endpoint=`/versions/${version}/samples`;
      }
      if(selection) {const row=await detail("selections",selection); if(row.datasetId!==entityId) throw new ApiError("选集不属于当前数据集",404);endpoint=`/selections/${selection}/samples`;}
      if(params.get("tab")==="版本") state.page=state.versionPage;
      else {const rows=await members(endpoint); if(version && version!=="working") current.versions.find((item:any)=>item.id===version).samples=rows;else current.samples=rows; if(selection) (state.selections.find(item=>item.id===selection)!).sampleIds=rows.map(item=>item.id);}
    }
    if(primary === "tasks") {const dataset=await detail("datasets",current.datasetId); await detail("specs",current.specId); dataset.samples=await members(`/tasks/${entityId}/samples`);current.sampleIds=dataset.samples.map((item:any)=>item.id);if(state.selectedSample&&!current.sampleIds.includes(state.selectedSample.id)) {dataset.samples.push(state.selectedSample);current.sampleIds.push(state.selectedSample.id);} }
    if(primary === "benchmarks") {const dataset=await detail("datasets",current.datasetId);const version=await platformRequest<any>(project,`/versions/${current.datasetVersion}`);version.samples=await members(`/benchmarks/${entityId}/samples`);dataset.versions=[{...version}];current.sampleIds=version.samples.map((item:any)=>item.id);current.sampleCount=state.page?.total??current.sampleCount;}
    if(primary === "experiments") {
      const benchmark=await detail("benchmarks",current.benchmarkId);const dataset=await detail("datasets",benchmark.datasetId);
      const version=await platformRequest<any>(project,`/versions/${benchmark.datasetVersion}`);version.samples=[];dataset.versions=[version];
      const page=await platformRequest<PageResult<any>>(project,`/experiments/${entityId}/results?${qs(true)}`);current.results=page.items;if("aggregates" in page)current.aggregates=page.aggregates;state.page={...page,items:undefined,resource:"results"};
      const samples:any[]=[];
      for(let offset=0;offset<page.items.length;offset+=8) {
        const batch=await Promise.all(page.items.slice(offset,offset+8).map(result=>platformRequest<PageResult<any>>(project,`/benchmarks/${benchmark.id}/samples?limit=1&sampleId=${encodeURIComponent(result.sampleId)}`)));
        samples.push(...batch.flatMap(item=>item.items));
      }
      // Before execution, expose a membership page for explicit manual entry.
      if(!page.items.length) samples.push(...(await platformRequest<PageResult<any>>(project,`/benchmarks/${benchmark.id}/samples?limit=50`)).items);
      version.samples=samples;benchmark.sampleIds=samples.map(item=>item.id);
      const selectedId=params.get("sample");
      if(selectedId) {
        state.selectedSample=samples.find(item=>item.id===selectedId);
        if(!state.selectedSample) state.selectedSample=(await platformRequest<PageResult<any>>(project,`/benchmarks/${benchmark.id}/samples?limit=1&sampleId=${encodeURIComponent(selectedId)}`)).items[0];
        if(state.selectedSample) state.selectedResult=current.results.find((item:any)=>item.sampleId===selectedId) ?? (await platformRequest<PageResult<any>>(project,`/experiments/${entityId}/results?limit=1&sampleId=${encodeURIComponent(selectedId)}`)).items[0];
      }
    }
    if(primary === "feedback") {
      const dataset=await detail("datasets",current.datasetId);
      dataset.samples=[await platformRequest<any>(project,`/samples/${current.sampleId}`)];
      if(current.experimentId) {
        const experiment=await detail("experiments",current.experimentId);
        const benchmark=await detail("benchmarks",experiment.benchmarkId);
        if(benchmark.datasetId!==dataset.id) throw new ApiError("反馈基准不属于来源数据集",404);
        const version=await platformRequest<any>(project,`/versions/${benchmark.datasetVersion}`);
        const [members,results]=await Promise.all([
          platformRequest<PageResult<any>>(project,`/benchmarks/${benchmark.id}/samples?limit=1&sampleId=${encodeURIComponent(current.sampleId)}`),
          platformRequest<PageResult<any>>(project,`/experiments/${experiment.id}/results?limit=1&sampleId=${encodeURIComponent(current.sampleId)}`),
        ]);
        version.samples=members.items;dataset.versions=[version];experiment.results=results.items;
      }
      if(current.taskId)await detail("tasks",current.taskId);
      if(current.selectionId){const selection=await detail("selections",current.selectionId);const page=await platformRequest<PageResult<any>>(project,`/selections/${selection.id}/samples?limit=50`);selection.sampleIds=page.items.map(item=>item.id);}
    }
  }
  return state;
}
export const platformStateQuery = (project: string, user: string, pathname = `/projects/${project}/datasets`, search = "") => queryOptions({
  queryKey:["data-platform",project,user,pathname,search], queryFn: () => readPlatformView(project,pathname,search), staleTime:10_000, refetchInterval:30_000,
});
