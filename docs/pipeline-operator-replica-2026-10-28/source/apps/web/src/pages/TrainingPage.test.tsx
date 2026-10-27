import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { server } from "../test/server";
import TrainingPage, { TrainingLossChart } from "./TrainingPage";

const context=vi.hoisted(()=>({search:"",canTrain:true,navigate:vi.fn()}));
vi.mock("../auth-context",()=>({useProjectAuth:()=>({me:{user:{id:"user"},csrf_token:"csrf"},can:(permission:string)=>permission!=="data_platform:train"||context.canTrain})}));
vi.mock("@tanstack/react-router",()=>({useRouterState:({select}:{select:(state:unknown)=>unknown})=>select({location:{pathname:"/projects/demo/training",searchStr:context.search}}),useNavigate:()=>context.navigate,Link:({children,...props}:Record<string,unknown>)=><a {...props}>{children as React.ReactNode}</a>}));
const root="http://api.test/api/data-platform";
const job={id:"job",name:"真实视频训练",status:"pending",runtimeStatus:"draft",revision:1,backend:"local-cpu",templateId:"video-frame-predictor-v1",datasetVersionId:"version",datasetId:"dataset",datasetDigest:"a".repeat(64),trainSampleCount:2,valSampleCount:1,modelName:"predictor",modelVersion:"v1",parameters:{epochs:5},resources:{cpu:1},progress:{},codeRevision:"video-frame-predictor-v1",image:"builtin:video-frame-predictor-v1"};
const page=(items:unknown[],total=items.length,nextCursor:string|null=null)=>({items,total,nextCursor});
const clients:QueryClient[]=[];
function show(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return render(<QueryClientProvider client={client}><TrainingPage/></QueryClientProvider>);}
async function chooseToolbar(label:string, option:string){
 fireEvent.click(screen.getByRole("button",{name:label}));
 fireEvent.click(await screen.findByRole("menuitemradio",{name:option}));
}
beforeEach(()=>{context.search="";context.canTrain=true;context.navigate.mockReset();vi.stubEnv("VITE_API_BASE_URL","http://api.test");server.use(
 http.get(`${root}/training/templates`,()=>HttpResponse.json({items:[{id:"video-frame-predictor-v1",name:"CPU视频帧预测",description:"真实下一帧训练",backend:"local-cpu"}],localAvailable:true,externalConfigured:false})),
 http.get(`${root}/training/jobs`,()=>HttpResponse.json(page([job]))),
 http.get(`${root}/training/jobs/job`,()=>HttpResponse.json(job)),
 http.get(`${root}/training/jobs/job/metrics`,()=>HttpResponse.json(page([]))),
 http.get(`${root}/training/jobs/job/checkpoints`,()=>HttpResponse.json(page([]))),
 http.get(`${root}/datasets`,()=>HttpResponse.json(page([{id:"dataset",name:"视频数据"}]))),
 http.get(`${root}/datasets/dataset/versions`,()=>HttpResponse.json(page([{id:"version",version:"v1",splitCounts:{train:2,val:1}}]))),
);});
afterEach(()=>{cleanup();clients.forEach(client=>client.clear());clients.length=0;vi.unstubAllEnvs();});

it("keeps whole task total while paging and resets the cursor when filters change",async()=>{
 const requests:URL[]=[];server.use(http.get(`${root}/training/jobs`,({request})=>{const url=new URL(request.url);requests.push(url);return HttpResponse.json(url.searchParams.has("cursor")?page([{...job,id:"later",name:"跨页训练"}],105):page([job],105,"next"));}));show();
 await screen.findByText("真实视频训练");expect(screen.getByText("共 105 项 · 第 1 页")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"下一页任务"}));await screen.findByText("跨页训练");
 await chooseToolbar("训练状态","已完成");await waitFor(()=>expect(requests.some(url=>url.searchParams.get("status")==="completed"&&!url.searchParams.has("cursor"))).toBe(true));
 await screen.findByText("真实视频训练");expect(screen.getByRole("button",{name:"上一页任务"})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"下一页任务"}));await screen.findByText("跨页训练");
 await chooseToolbar("训练执行方式","本机 CPU");await waitFor(()=>expect(requests.at(-1)?.searchParams.get("backend")).toBe("local-cpu"));
 expect(requests.at(-1)?.searchParams.get("status")).toBe("completed");expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
 expect(requests.every(url=>url.searchParams.get("project_id")==="demo")).toBe(true);
 await screen.findByText("真实视频训练");expect(screen.getByRole("button",{name:"上一页任务"})).toBeDisabled();
});

it("preserves the new training form after a rejected dataset and sends a frozen CPU configuration",async()=>{
 let submitted:Record<string,unknown>|undefined;server.use(http.post(`${root}/training/jobs`,async({request})=>{submitted=await request.json() as Record<string,unknown>;expect(request.headers.get("X-CSRF-Token")).toBe("csrf");return HttpResponse.json({detail:"视频版本未通过质量门禁"},{status:422});}));show();
 await screen.findByText("真实视频训练");fireEvent.click(screen.getByRole("button",{name:"新建训练"}));fireEvent.change(screen.getByLabelText("任务名称"),{target:{value:"保留输入"}});fireEvent.change(screen.getByLabelText("模型名称"),{target:{value:"predictor"}});
 await screen.findByRole("option",{name:"视频数据"});fireEvent.change(screen.getByRole("combobox",{name:"视频数据集"}),{target:{value:"dataset"}});await screen.findByRole("option",{name:/v1 · train 2/});fireEvent.change(screen.getByRole("combobox",{name:"已发布数据版本"}),{target:{value:"version"}});
 fireEvent.click(screen.getByRole("button",{name:"保存训练配置"}));await screen.findByText("视频版本未通过质量门禁");expect(screen.getByLabelText("任务名称")).toHaveValue("保留输入");expect(submitted).toMatchObject({datasetVersionId:"version",backend:"local-cpu",parameters:{epochs:5,frameSize:8},resources:{device:"cpu",cpu:1}});
 expect(screen.queryByRole("option",{name:/点云/})).not.toBeInTheDocument();
});

it("hides training controls for readers",async()=>{
 context.search="?job=job";context.canTrain=false;show();await screen.findByRole("heading",{name:"真实视频训练"});expect(screen.getByRole("button",{name:"新建训练"})).toBeDisabled();expect(screen.queryByRole("button",{name:"开始训练"})).not.toBeInTheDocument();
});

it("announces a failed training action and replaces it with a success status on retry",async()=>{
 context.search="?job=job";let attempt=0;
 server.use(http.post(`${root}/training/jobs/job/submit`,()=>++attempt===1?HttpResponse.json({detail:"训练服务暂不可用"},{status:503}):HttpResponse.json({...job,runtimeStatus:"queued"})));
 show();fireEvent.click(await screen.findByRole("button",{name:"开始训练"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("训练服务暂不可用");
 await waitFor(()=>expect(screen.getByRole("button",{name:"开始训练"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"开始训练"}));
 expect(await screen.findByText("任务已排队，由训练 Worker 执行。")).toHaveAttribute("role","status");
 expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("freezes an explicit GPU count when creating an external video job",async()=>{
 let submitted:Record<string,unknown>|undefined;
 server.use(http.get(`${root}/training/templates`,()=>HttpResponse.json({items:[{id:"video-frame-predictor-v1",name:"CPU视频帧预测",backend:"local-cpu"},{id:"video-world-model-external-v1",name:"外部世界模型",backend:"external"}],localAvailable:true,externalConfigured:true})),http.post(`${root}/training/jobs`,async({request})=>{submitted=await request.json() as Record<string,unknown>;return HttpResponse.json({...job,backend:"external"},{status:201});}));
 show();await screen.findByText("真实视频训练");fireEvent.click(screen.getByRole("button",{name:"新建训练"}));fireEvent.change(screen.getByRole("combobox",{name:"训练模板"}),{target:{value:"video-world-model-external-v1"}});
 fireEvent.change(screen.getByLabelText("任务名称"),{target:{value:"外部GPU任务"}});fireEvent.change(screen.getByLabelText("模型名称"),{target:{value:"world-model"}});fireEvent.change(screen.getByLabelText("代码修订"),{target:{value:"a".repeat(40)}});fireEvent.change(screen.getByLabelText("训练镜像"),{target:{value:"trainer@sha256:"+"b".repeat(64)}});
 await screen.findByRole("option",{name:"视频数据"});fireEvent.change(screen.getByRole("combobox",{name:"视频数据集"}),{target:{value:"dataset"}});await screen.findByRole("option",{name:/v1 · train 2/});fireEvent.change(screen.getByRole("combobox",{name:"已发布数据版本"}),{target:{value:"version"}});fireEvent.click(screen.getByRole("button",{name:"保存训练配置"}));
 await waitFor(()=>expect(submitted).toMatchObject({templateId:"video-world-model-external-v1",backend:"external",parameters:{},resources:{device:"gpu",gpuCount:1}}));
});

it("plots only finite real values from the latest execution attempt",()=>{
 render(<TrainingLossChart rows={[{id:"old",attempt:1,epoch:1,step:1,metrics:{train_loss:100},logs:"",createdAt:""},{id:"new",attempt:2,epoch:1,step:1,metrics:{train_loss:.5},logs:"",createdAt:""},{id:"new2",attempt:2,epoch:2,step:2,metrics:{train_loss:.2},logs:"",createdAt:""}]}/>);
 expect(screen.getByRole("img",{name:"train_loss 曲线，2 个实测点"})).toBeInTheDocument();expect(screen.getByText(/最新值 0.20000/)).toBeInTheDocument();
});

it("offers a first-task action without empty filters, table headings or pagination",async()=>{
 server.use(http.get(`${root}/training/jobs`,()=>HttpResponse.json(page([]))));show();
 await screen.findByRole("heading",{name:"还没有训练任务"});
 expect(screen.queryByRole("navigation",{name:"训练任务分页"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"训练状态"})).not.toBeInTheDocument();
 expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
 expect(screen.getAllByRole("button",{name:"新建训练"})).toHaveLength(2);
 expect(screen.getByText("执行环境与训练说明").closest("details")).not.toHaveAttribute("open");
});

it("keeps returning from an empty later page possible and provides a filter reset",async()=>{
 server.use(http.get(`${root}/training/jobs`,({request})=>{const url=new URL(request.url);return HttpResponse.json(url.searchParams.get("cursor")||url.searchParams.get("status")?page([],0):page([job],1,"next"));}));show();
 await screen.findByText("真实视频训练");fireEvent.click(screen.getByRole("button",{name:"下一页任务"}));
 await screen.findByText("当前页没有任务，可返回上一页继续查看。");
 expect(screen.getByRole("button",{name:"上一页任务"})).toBeEnabled();
 fireEvent.click(screen.getByRole("button",{name:"上一页任务"}));await screen.findByText("真实视频训练");
 await chooseToolbar("训练状态","已完成");await screen.findByRole("heading",{name:"没有匹配的结果"});
 fireEvent.click(screen.getByRole("button",{name:"清除筛选"}));await screen.findByText("真实视频训练");
 expect(screen.getByRole("button",{name:"训练状态"})).toHaveTextContent("全部状态");
});

it("supports keyboard selection and an associated training detail panel",async()=>{
 context.search="?job=job";show();await screen.findByRole("heading",{name:"真实视频训练"});
 const overviewTab=screen.getByRole("tab",{name:"概览"});overviewTab.focus();fireEvent.keyDown(overviewTab,{key:"ArrowRight"});
 const metricsTab=screen.getByRole("tab",{name:"指标与日志"});expect(metricsTab).toHaveFocus();expect(metricsTab).toHaveAttribute("aria-selected","true");
 expect(screen.getByRole("tabpanel",{name:"指标与日志"})).toHaveAttribute("id",metricsTab.getAttribute("aria-controls"));
 expect(screen.queryByText("冻结配置")).not.toBeInTheDocument();
});

it("selects an available custom template without a hidden default ID",async()=>{
 let submitted:Record<string,unknown>|undefined;
 server.use(http.get(`${root}/training/templates`,()=>HttpResponse.json({items:[{id:"custom-external",name:"项目外部模板",backend:"external"}],externalConfigured:true})),http.post(`${root}/training/jobs`,async({request})=>{submitted=await request.json() as Record<string,unknown>;return HttpResponse.json({...job,backend:"external"},{status:201});}));
 show();await screen.findByText("真实视频训练");fireEvent.click(screen.getByRole("button",{name:"新建训练"}));
 expect(screen.getByRole("combobox",{name:"训练模板"})).toHaveValue("custom-external");
 fireEvent.change(screen.getByLabelText("任务名称"),{target:{value:"外部模板默认选择"}});fireEvent.change(screen.getByLabelText("模型名称"),{target:{value:"predictor"}});
 fireEvent.change(screen.getByLabelText("代码修订"),{target:{value:"a".repeat(40)}});fireEvent.change(screen.getByLabelText("训练镜像"),{target:{value:"trainer@sha256:"+"b".repeat(64)}});
 await screen.findByRole("option",{name:"视频数据"});fireEvent.change(screen.getByRole("combobox",{name:"视频数据集"}),{target:{value:"dataset"}});await screen.findByRole("option",{name:/v1 · train 2/});fireEvent.change(screen.getByRole("combobox",{name:"已发布数据版本"}),{target:{value:"version"}});
 fireEvent.click(screen.getByRole("button",{name:"保存训练配置"}));await waitFor(()=>expect(submitted).toMatchObject({templateId:"custom-external",backend:"external"}));
});

it("does not poll a completed detail or request hidden metric and checkpoint tabs",async()=>{
 vi.useFakeTimers({toFake:["setInterval","clearInterval"]});
 try {
  let detailReads=0,metricReads=0,checkpointReads=0;
  server.use(http.get(`${root}/training/jobs/job`,()=>{detailReads++;return HttpResponse.json({...job,runtimeStatus:"completed"});}),http.get(`${root}/training/jobs/job/metrics`,()=>{metricReads++;return HttpResponse.json(page([]));}),http.get(`${root}/training/jobs/job/checkpoints`,()=>{checkpointReads++;return HttpResponse.json(page([]));}));
  context.search="?job=job";show();await screen.findByRole("heading",{name:"真实视频训练"});
  await vi.advanceTimersByTimeAsync(6000);
  expect(detailReads).toBe(1);expect(metricReads).toBe(0);expect(checkpointReads).toBe(0);
  fireEvent.click(screen.getByRole("tab",{name:"指标与日志"}));await screen.findByText("尚无训练实测指标，任务执行后将显示曲线。");
  await vi.advanceTimersByTimeAsync(6000);expect(metricReads).toBe(1);expect(checkpointReads).toBe(0);
 } finally {vi.useRealTimers();}
});
