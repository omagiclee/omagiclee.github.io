import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup,fireEvent,render,screen,waitFor,within } from "@testing-library/react";
import { useState } from "react";
import { http,HttpResponse } from "msw";
import { afterEach,it,expect,vi } from "vitest";
import { server } from "../test/server";
import { ConnectionRuntimeControls } from "./ConnectionRuntimeControls";
import { ExecutionWorkers } from "./ExecutionWorkers";
import { ExecutionSelection, type ExecutionTarget } from "./ExecutionSelection";
import type { ProjectConnection } from "../platform-api";
afterEach(()=>{cleanup();vi.unstubAllEnvs();});
const wrap=(element:React.ReactNode)=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{element}</QueryClientProvider>);
it("uses real probe/sync endpoints with CSRF and displays the committed cursor",async()=>{
 vi.stubEnv("VITE_API_BASE_URL","http://api.test");let reads=0;
 server.use(http.get("http://api.test/api/projects/demo/connections/source/inventory",()=>{reads++;return HttpResponse.json({items:[{id:"1",object_key:"uploads/a",size:3}],has_more:false,cursor:reads===1?null:"page-2",generation:1});}),
 http.post("http://api.test/api/projects/demo/connections/source/probe",async({request})=>{expect(request.headers.get("x-csrf-token")).toBe("csrf");expect(await request.json()).toEqual({environment_id:"env"});return HttpResponse.json({passed:true,backend:"local",sample_count:1});}),
 http.post("http://api.test/api/projects/demo/connections/source/inventory-sync",async({request})=>{expect(request.headers.get("x-csrf-token")).toBe("csrf");expect(await request.json()).toEqual({environment_id:"env",page_size:100});return HttpResponse.json({processed:100,scan_complete:false});}));
 wrap(<ConnectionRuntimeControls environments={[{id:"env",name:"测试执行环境"}]} projectId="demo" csrf="csrf" canManage connection={{id:"source",name:"Local",allowed_environment_ids:["env"]} as ProjectConnection}/>);
 expect(reads).toBe(0);fireEvent.click(screen.getByText("对象目录与探测"));await screen.findByText("uploads/a · 3 bytes");expect(screen.getByRole("option",{name:"测试执行环境"})).toHaveValue("env");
 fireEvent.click(screen.getByText("只读探测"));await screen.findByText("只读探测通过：local，样本 1 个对象。");
 fireEvent.click(screen.getByText("同步下一页对象"));await screen.findByText(/已提交 100 个对象/);await screen.findByText(/有待同步页面/);
});
it("shows stale targets as offline and does not display machine credentials",async()=>{
 vi.stubEnv("VITE_API_BASE_URL","http://api.test");server.use(http.get("http://api.test/api/execution-workers",()=>HttpResponse.json([{id:"1",name:"Worker A",pool_id:"pool",target:"daemon-a",kind:"docker-daemon",cpu_arch:"arm64",resource_kind:"cpu",capacity:2,online:false,healthy:true,draining:false,heartbeat_at:"2026-01-01T00:00:00Z"}])));
 wrap(<ExecutionWorkers/>);fireEvent.click(screen.getByText("查看执行目标"));await screen.findByText("离线 / 探测失败");expect(screen.queryByText(/worker_token/)).not.toBeInTheDocument();
});
it("anchors execution choices, preserves target IDs and returns keyboard focus",async()=>{
 vi.stubEnv("VITE_API_BASE_URL","http://api.test");
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 server.use(http.get("http://api.test/api/projects/demo/environments",async()=>{await gate;return HttpResponse.json([{id:"env-1",name:"视频测试环境",revision:2,status:"configured",worker_pools:[{id:"pool-1",name:"CPU 测试资源池",status:"configured",resource_kind:"cpu",runtime:{status:"registered",cpu_arch:"arm64"}}]}]);}));
 function Target(){const[value,setValue]=useState<ExecutionTarget>({});return <><ExecutionSelection projectId="demo" value={value} onChange={setValue} disabled={false}/><output>{JSON.stringify(value)}</output></>;}
 wrap(<Target/>);const trigger=screen.getByRole("button",{name:"执行环境 · 本地默认"});trigger.focus();fireEvent.click(trigger);
 const popup=await screen.findByRole("dialog",{name:"运行执行目标"});
 expect(trigger).toHaveAttribute("aria-expanded","true");expect(await within(popup).findByRole("status")).toHaveTextContent("正在读取执行环境");
 release();await screen.findByRole("option",{name:"视频测试环境 · r2"});
 fireEvent.change(screen.getByLabelText("运行执行环境"),{target:{value:"env-1"}});fireEvent.change(screen.getByLabelText("运行 Worker 资源池"),{target:{value:"pool-1"}});
 expect(screen.getByText('{"environment_id":"env-1","worker_pool_id":"pool-1"}')).toBeInTheDocument();
 fireEvent.keyDown(popup,{key:"Escape"});await waitFor(()=>expect(screen.queryByRole("dialog",{name:"运行执行目标"})).not.toBeInTheDocument());
 expect(trigger).toHaveAttribute("aria-expanded","false");await waitFor(()=>expect(trigger).toHaveFocus());
});

it("uses a registration empty state without orphaned worker table headers",async()=>{
 vi.stubEnv("VITE_API_BASE_URL","http://api.test");server.use(http.get("http://api.test/api/execution-workers",()=>HttpResponse.json([])));
 wrap(<ExecutionWorkers/>);fireEvent.click(screen.getByRole("button",{name:"查看执行目标"}));await screen.findByText(/尚未登记执行目标/);expect(screen.queryByRole("table")).not.toBeInTheDocument();expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
});
