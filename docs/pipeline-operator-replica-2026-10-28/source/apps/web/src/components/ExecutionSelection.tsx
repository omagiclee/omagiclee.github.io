import { Popover } from "@base-ui/react/popover";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { projectEnvironmentsQueryFor } from "../platform-api";
import { Button } from "./ui/button";
export interface ExecutionTarget {environment_id?:string;worker_pool_id?:string}
export function ExecutionSelection({projectId,value,onChange,disabled}:{projectId:string;value:ExecutionTarget;onChange:(value:ExecutionTarget)=>void;disabled:boolean}){
 const [open,setOpen]=useState(false);const environments=useQuery({...projectEnvironmentsQueryFor(projectId),enabled:open});
 const environment=environments.data?.find(row=>row.id===value.environment_id);
 return <Popover.Root open={open} onOpenChange={setOpen}>
  <Popover.Trigger disabled={disabled} render={<Button size="sm" variant="outline" />}>执行环境{value.environment_id?" · 已选择":" · 本地默认"}</Popover.Trigger>
  <Popover.Portal><Popover.Positioner sideOffset={8} align="end" className="pipe-execution-positioner"><Popover.Popup aria-label="运行执行目标" className="pipe-execution-selection-panel">
   <label className="pipe-field"><span>执行环境</span><select aria-label="运行执行环境" disabled={disabled} value={value.environment_id??""} onChange={e=>onChange(e.target.value?{environment_id:e.target.value}:{})}><option value="">本地默认环境</option>{environments.data?.filter(row=>row.status!=="disabled").map(row=><option key={row.id} value={row.id}>{row.name} · r{row.revision}</option>)}</select></label>
   <label className="pipe-field"><span>Worker 资源池</span><select aria-label="运行 Worker 资源池" disabled={disabled||!environment} value={value.worker_pool_id??""} onChange={e=>onChange({...value,worker_pool_id:e.target.value||undefined})}><option value="">自动选择兼容资源池</option>{environment?.worker_pools.filter(pool=>pool.status!=="disabled"&&pool.runtime.status!=="disabled").map(pool=><option key={pool.id} value={pool.id}>{pool.name} · {pool.resource_kind} · {pool.runtime.cpu_arch}</option>)}</select></label>
   {environments.isPending&&<p role="status">正在读取执行环境…</p>}
   <p>目标与运行提交一起冻结；没有健康执行目标时保持排队。对象连接源必须选择已获授的环境。</p>
   {environments.error&&<p role="alert" className="text-destructive">{environments.error.message}</p>}
  </Popover.Popup></Popover.Positioner></Popover.Portal>
 </Popover.Root>;
}
