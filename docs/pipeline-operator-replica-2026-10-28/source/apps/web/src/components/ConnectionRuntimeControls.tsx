import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "./ui/button";
import type { ExecutionEnvironment, ProjectConnection } from "../platform-api";
import { inventoryQuery, probeObjectConnection, syncObjectInventory } from "../runtime-api";
import { interactionForEvent, type InteractionContext } from "../telemetry";
export function ConnectionRuntimeControls({connection,environments,projectId,csrf,canManage}:{connection:ProjectConnection;environments:Pick<ExecutionEnvironment,"id"|"name">[];projectId:string;csrf:string;canManage:boolean}) {
 const [open,setOpen]=useState(false),[environment,setEnvironment]=useState(connection.allowed_environment_ids[0]??""),[offset,setOffset]=useState(0),[notice,setNotice]=useState("");
 const panelId=useId();
 const client=useQueryClient();
 const inventory=useQuery({...inventoryQuery(projectId,connection.id,offset),enabled:open});
 const probe=useMutation({mutationFn:(interaction?:InteractionContext)=>probeObjectConnection(projectId,connection.id,environment,csrf,interaction),onMutate:()=>{setNotice("");sync.reset();},onSuccess:r=>setNotice(`只读探测通过：${r.backend}，样本 ${r.sample_count} 个对象。`)});
 const sync=useMutation({mutationFn:(interaction?:InteractionContext)=>syncObjectInventory(projectId,connection.id,environment,csrf,interaction),onMutate:()=>{setNotice("");probe.reset();},onSuccess:async r=>{setNotice(`已提交 ${r.processed} 个对象；${r.scan_complete?"本轮扫描完成":"游标已推进，可继续同步下一页"}。`);await client.invalidateQueries({queryKey:["connection-inventory",projectId,connection.id]});}});
 return <div className="connection-runtime-controls"><Button variant="outline" size="sm" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(!open)}>{open?"收起对象目录":"对象目录与探测"}</Button>{open&&<section id={panelId} className="connection-runtime-panel" aria-label={`${connection.name} 运行时连接`}>
 <label>执行环境 <select aria-label={`${connection.name} 探测环境`} value={environment} onChange={e=>setEnvironment(e.target.value)}>{connection.allowed_environment_ids.map(id=><option key={id} value={id}>{environments.find(item=>item.id===id)?.name || `环境 · ${id.slice(0,8)}`}</option>)}</select></label>
 <div className="connection-runtime-actions"><Button variant="outline" size="sm" disabled={!canManage||!environment||probe.isPending} onClick={e=>probe.mutate(interactionForEvent(e.nativeEvent))}>只读探测</Button>
 <Button variant="outline" size="sm" disabled={!canManage||!environment||sync.isPending} onClick={e=>sync.mutate(interactionForEvent(e.nativeEvent))}>同步下一页对象</Button></div>
 <p>探测会实际读取项目命名空间；目录按页提交，失败后可重放。数据库、向量库及模型连接暂仅提供配置治理。</p>
 {inventory.isPending&&<p role="status">正在读取对象目录…</p>}
 {notice&&<p className="connection-runtime-notice" role="status">{notice}</p>}{(probe.error||sync.error||inventory.error)&&<p className="connection-runtime-error" role="alert">{probe.error?.message??sync.error?.message??inventory.error?.message}</p>}
 {inventory.data&&<><p>扫描轮次 {inventory.data.generation} · {inventory.data.cursor?"有待同步页面":"无待同步游标"}</p><ul>{inventory.data.items.map(item=><li key={item.id}>{item.object_key} · {item.size} bytes</li>)}</ul><Button variant="outline" size="sm" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-25))}>上一页目录</Button><Button variant="outline" size="sm" disabled={!inventory.data.has_more} onClick={()=>setOffset(offset+25)}>下一页目录</Button></>}
 </section>}</div>;
}
