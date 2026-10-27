import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiUrl } from "./auth-api";
import { instrumentedFetch, type InteractionContext } from "./telemetry";
export interface ExecutionWorker { id:string; pool_id:string; name:string; kind:string; target:string; cpu_arch:string; resource_kind:string; capacity:number; healthy:boolean; online:boolean; draining:boolean; heartbeat_at:string }
export interface ObjectInventory { items:{id:string; object_key:string; uri:string; size:number; etag:string}[]; has_more:boolean; cursor:string|null; generation:number }
async function request<T>(path:string, csrf?:string, body?:unknown, interaction?:InteractionContext):Promise<T> {
  const response=await instrumentedFetch(apiUrl(path),{credentials:"include",...(body!==undefined?{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":csrf??""},body:JSON.stringify(body)}:{})},interaction);
  if(!response.ok){const data=await response.json().catch(()=>({}));throw new ApiError(typeof data.detail==="string"?data.detail:`请求失败（${response.status}）`,response.status);}
  return response.json();
}
export const workersQuery=queryOptions({queryKey:["execution-workers"],queryFn:()=>request<ExecutionWorker[]>("/api/execution-workers"),refetchInterval:20000});
const connectionPath=(project:string,id:string)=>`/api/projects/${encodeURIComponent(project)}/connections/${encodeURIComponent(id)}`;
export const inventoryQuery=(project:string,id:string,offset=0)=>queryOptions({queryKey:["connection-inventory",project,id,offset],queryFn:()=>request<ObjectInventory>(`${connectionPath(project,id)}/inventory?limit=25&offset=${offset}`)});
export const probeObjectConnection=(project:string,id:string,environment_id:string,csrf:string,interaction?:InteractionContext)=>request<{passed:boolean;backend:string;sample_count:number}>(`${connectionPath(project,id)}/probe`,csrf,{environment_id},interaction);
export const syncObjectInventory=(project:string,id:string,environment_id:string,csrf:string,interaction?:InteractionContext)=>request<{processed:number;scan_complete:boolean}>(`${connectionPath(project,id)}/inventory-sync`,csrf,{environment_id,page_size:100},interaction);
