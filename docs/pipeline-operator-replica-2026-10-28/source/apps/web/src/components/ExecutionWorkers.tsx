import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { workersQuery } from "../runtime-api";
import { Button } from "./ui/button";
export function ExecutionWorkers(){
 const panelId=useId();
 const [open,setOpen]=useState(false);const workers=useQuery({...workersQuery,enabled:open});
 return <section className="pipe-control-section"><h2>执行目标心跳</h2><p>资源池运行前须登记可探测的 local-dagster 或管理员配置的 Docker daemon。停止心跳或进入排空状态后不再接收新运行。</p><Button variant="outline" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(!open)}>{open?"收起执行目标":"查看执行目标"}</Button>{open&&<div id={panelId}>{workers.isPending&&<p role="status">正在读取执行目标…</p>}{workers.error&&<p role="alert">{workers.error.message}</p>}{workers.data&&(workers.data.length?<div className="pipe-directory"><table><thead><tr><th>Worker</th><th>目标</th><th>能力</th><th>健康</th><th>最近心跳</th></tr></thead><tbody>{workers.data.map(row=><tr key={row.id}><td>{row.name}<p>{row.pool_id}</p></td><td>{row.kind} · {row.target}</td><td>{row.cpu_arch} · {row.resource_kind} · 并发 {row.capacity}</td><td>{row.draining?"排空中":row.online?"在线":"离线 / 探测失败"}</td><td>{new Date(row.heartbeat_at).toLocaleString()}</td></tr>)}</tbody></table></div>:<p>尚未登记执行目标。由服务器 Worker agent 使用机器凭据登记并持续探活。</p>)}</div>}</section>;
}
