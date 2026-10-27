import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {expect,test} from "@playwright/test";
const api=`http://127.0.0.1:${process.env.E2E_API_PORT ?? 8010}`;

test("shared dataset, annotation review, frozen publication, training lineage and failed evaluation",async({page})=>{
  await page.goto('/projects/demo/datasets');
  await expect(page.getByRole('heading',{name:'数据集',exact:true})).toBeVisible();
  const name=`真实闭环 ${Date.now()}`;
  await page.locator('.platform-page-heading').getByRole('button',{name:'导入数据'}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('数据集名称').fill(name);
  await dialog.getByLabel('样本内容').fill('这是用于端到端验证的独立真实输入');
  await dialog.getByLabel('样本划分').selectOption('train');
  await dialog.getByRole('button',{name:'创建数据集'}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  const me=await (await page.request.get(`${api}/api/me`)).json();
  const write=async(path:string,body:unknown,expected=201)=>{const response=await page.request.post(`${api}/api/data-platform${path}?project_id=demo`,{headers:{'X-CSRF-Token':me.csrf_token},data:body});expect(response.status(),await response.text()).toBe(expected);return response.json();};
  const state=await (await page.request.get(`${api}/api/data-platform/state?project_id=demo`)).json();
  const dataset=state.datasets.find((row:any)=>row.name===name);
  const reviewer=state.users.find((row:any)=>row.id!==me.user.id && row.canReview);
  expect(reviewer).toBeTruthy();
  const spec=await write('/specs',{name:`规范 ${name}`,type:'文本',labels:['valid'],instructions:'输出准确描述，标签 valid'});
  const task=await write('/tasks',{name:`任务 ${name}`,datasetId:dataset.id,sampleIds:dataset.samples.map((row:any)=>row.id),specId:spec.id,assignee:me.user.id,reviewer:reviewer.id});
  await page.goto(`/projects/demo/annotation/tasks/${task.id}?workspace=annotate&sample=${dataset.samples[0].id}`);
  await expect(page.getByRole('heading',{name:'标注工作区',exact:true})).toBeVisible();
  await page.getByLabel('标注内容', {exact:true}).fill('经过人工核验的参考回答');
  await page.getByLabel('标签', {exact:true}).fill('valid');
  await page.getByRole('button',{name:'提交审核'}).click();
  await expect(page.getByText('已提交审核。',{exact:true})).toBeVisible();
  let response=await page.request.post(`${api}/api/admin/impersonation/start`,{headers:{'X-CSRF-Token':me.csrf_token},data:{target_user_id:reviewer.id,reason:'端到端验证独立审核角色和数据隔离'}});
  expect(response.ok(),await response.text()).toBeTruthy();
  await page.goto(`/projects/demo/annotation/tasks/${task.id}?workspace=review&sample=${dataset.samples[0].id}`);
  await expect(page.getByRole('button',{name:'审核通过'})).toBeEnabled();
  await page.getByRole('button',{name:'审核通过'}).click();
  await expect(page.getByText('审核已通过。',{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"退出代登录"}).click();
  await expect(page.getByLabel("代登录状态")).toHaveCount(0);
  await page.goto(`/projects/demo/datasets/${dataset.id}`);
  await page.getByRole('button',{name:'发布版本',exact:true}).click();dialog=page.getByRole('dialog');
  await dialog.getByLabel('发布说明').fill('独立人工审核后冻结');
  await dialog.getByRole('button',{name:'确认发布'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('独立人工审核后冻结')).toBeVisible();
  const updated=await (await page.request.get(`${api}/api/data-platform/state?project_id=demo`)).json();
  const version=updated.datasets.find((row:any)=>row.id===dataset.id).versions[0];
  const exported=await page.request.get(`${api}/api/data-platform/datasets/${dataset.id}/versions/${version.id}/export?project_id=demo`);
  expect(exported.ok()).toBeTruthy();expect(await exported.text()).toContain('经过人工核验的参考回答');
  await page.getByRole('tab',{name:'血缘与使用',exact:true}).click();
  await page.getByText('外部训练与模型记录', {exact:true}).click();
  await page.locator('.platform-section-heading').getByRole('button',{name:'登记训练结果'}).click();dialog=page.getByRole('dialog');
  for(const [label,value] of [['训练任务名称',name],['外部任务标识','external-training-123'],['代码修订','abcdef123456789'],['训练镜像','trainer@sha256:abc123'],['模型名称','test-trained-model'],['模型版本','1.0'],['模型产物地址','s3://models/test-trained-model/1.0']]) await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole('button',{name:'创建',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('external-training-123')).toBeVisible();
  await page.screenshot({path:'test-results/data-platform.png',fullPage:true});
});

test("publication failures keep the form input and cannot create a version",async({page})=>{
  await page.goto('/projects/demo/datasets');await page.locator('.platform-page-heading').getByRole('button',{name:'导入数据'}).click();
  const dialog=page.getByRole('dialog');await dialog.getByLabel('数据集名称').fill(`门禁 ${Date.now()}`);await dialog.getByLabel('样本内容').fill('尚未标注的工作样本');await dialog.getByRole('button',{name:'创建数据集'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await page.getByRole('button',{name:'发布版本',exact:true}).click();
  await page.getByRole('dialog').getByLabel('发布说明').fill('保留这段尚未提交的说明');await page.getByRole('button',{name:'确认发布'}).click();
  await expect(page.getByRole('dialog').getByText(/质量门禁未通过/)).toBeVisible();await expect(page.getByRole('dialog').getByLabel('发布说明')).toHaveValue('保留这段尚未提交的说明');
});

test('concurrent annotation conflict preserves the draft and requires explicit reload',async({page})=>{
  await page.goto('/projects/demo/datasets');await expect(page.getByRole('heading',{name:'数据集',exact:true})).toBeVisible();
  const me=await(await page.request.get(`${api}/api/me`)).json();
  const send=async(path:string,data:unknown)=>{const response=await page.request.post(`${api}/api/data-platform${path}?project_id=demo`,{headers:{'X-CSRF-Token':me.csrf_token},data});expect(response.status(),await response.text()).toBe(201);return response.json();};
  const dataset=await send('/datasets',{name:`并发修订 ${Date.now()}`,modality:'文本',purpose:'训练',samples:[{name:'并发样本',input:'不同于其它用例的并发输入',split:'train'}]});
  const state=await(await page.request.get(`${api}/api/data-platform/state?project_id=demo`)).json();
  const reviewer=state.users.find((row:any)=>row.id!==me.user.id&&row.canReview);
  const spec=await send('/specs',{name:'并发规范',type:'文本',labels:['valid'],instructions:'真实结果'});
  const task=await send('/tasks',{name:'并发任务',datasetId:dataset.id,sampleIds:[dataset.samples[0].id],specId:spec.id,assignee:me.user.id,reviewer:reviewer.id});
  await page.goto(`/projects/demo/annotation/tasks/${task.id}?workspace=annotate&sample=${dataset.samples[0].id}`);
  await page.getByRole('textbox',{name:'标注内容',exact:true}).fill('尚未保存的本地草稿');await page.getByLabel('标签',{exact:true}).fill('valid');
  await send(`/tasks/${task.id}/samples/${dataset.samples[0].id}/annotation`,{expectedRevision:dataset.samples[0].revision,output:'另一会话提交的最新内容',label:'valid'});
  await page.getByRole('button',{name:'提交审核'}).click();
  await expect(page.getByText(/未保存输入仍保留/)).toBeVisible();await expect(page.getByRole('textbox',{name:'标注内容',exact:true})).toHaveValue('尚未保存的本地草稿');
  await page.getByRole('button',{name:'重新加载最新标注'}).click();await expect(page.getByRole('textbox',{name:'标注内容',exact:true})).toHaveValue('另一会话提交的最新内容');
});

test("catalog toolbar menus preserve search, version state and keyboard focus", async ({page}) => {
  await page.goto("/projects/demo/datasets");
  await expect(page.getByRole("heading", {name:"数据集",exact:true})).toBeVisible();
  let me = await (await page.request.get(`${api}/api/me`)).json();
  const post = async (path:string, data:unknown) => {
    const response = await page.request.post(`${api}/api/data-platform${path}?project_id=demo`, {headers:{"X-CSRF-Token":me.csrf_token},data});
    expect(response.status(), await response.text()).toBe(201); return response.json();
  };
  const name = `目录菜单 ${Date.now()}`;
  const dataset = await post("/datasets", {name,modality:"文本",purpose:"评测",samples:[{name:"固定文本",input:`独立菜单验证输入 ${Date.now()}`,split:"test"}]});
  const users = await (await page.request.get(`${api}/api/data-platform/users?project_id=demo`)).json();
  const reviewer = users.items.find((user:any) => user.id !== me.user.id && user.canReview);
  const spec = await post("/specs", {name:`规范 ${name}`,type:"文本",labels:["valid"],instructions:"使用真实参考回答"});
  const task = await post("/tasks", {name:`任务 ${name}`,datasetId:dataset.id,sampleIds:[dataset.samples[0].id],specId:spec.id,assignee:me.user.id,reviewer:reviewer.id});
  const annotation = await post(`/tasks/${task.id}/samples/${dataset.samples[0].id}/annotation`, {expectedRevision:1,output:"独立核验后的固定参考",label:"valid"});
  const identity = async (operation:string, data?:unknown) => {
    const response = await page.request.post(`${api}/api/admin/impersonation/${operation}`, {headers:{"X-CSRF-Token":me.csrf_token},data});
    expect(response.ok(), await response.text()).toBeTruthy();
    me = await (await page.request.get(`${api}/api/me`)).json();
  };
  await identity("start", {target_user_id:reviewer.id,reason:"隔离数据库中的菜单与固定版本验证"});
  await post(`/tasks/${task.id}/samples/${dataset.samples[0].id}/review`, {expectedRevision:annotation.revision,annotationId:annotation.annotationId,decision:"approve"});
  await identity("stop");
  const current = await (await page.request.get(`${api}/api/data-platform/datasets/${dataset.id}?project_id=demo&summaryOnly=true`)).json();
  const version = await post(`/datasets/${dataset.id}/versions`, {expectedRevision:current.revision,description:"冻结菜单验证数据"});
  await page.goto("/projects/demo/datasets");
  await page.getByRole("textbox", {name:"搜索数据集名称"}).fill(name);
  const filter = page.getByRole("button", {name:"按模态筛选",exact:true});
  await filter.click();
  await page.getByRole("menuitemradio", {name:"图像",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`modality=${encodeURIComponent("图像")}`));
  await expect(page.getByRole("textbox", {name:"搜索数据集名称"})).toHaveValue(name);
  await expect(page.getByRole("heading", {name:"没有匹配的结果",exact:true})).toBeVisible();
  await filter.click();await page.getByRole("menuitemradio", {name:"文本",exact:true}).click();
  await expect(page.getByRole("link", {name,exact:true})).toBeVisible();
  await expect(filter).toBeFocused();
  await page.getByRole("link", {name,exact:true}).click();
  const switcher = page.getByRole("button", {name:"选择数据版本",exact:true});
  await switcher.click();await page.getByRole("menuitemradio", {name:"v1 · 已发布",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`version=${version.id}`));
  await expect(switcher).toBeFocused();
  const tab = page.getByRole("tab", {name:"数据",exact:true});await tab.focus();await tab.press("End");
  await expect(page.getByRole("tabpanel", {name:"血缘与使用",exact:true})).toBeVisible();
  await expect(page.getByRole("tab", {name:"血缘与使用",exact:true})).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`version=${version.id}`));
  const benchmark = await post("/benchmarks", {name:`基准 ${name}`,datasetId:dataset.id,datasetVersion:version.id,metric:"回答质量",rule:"人工评分",scorer:"manual-v1"});
  const experiment = await post("/experiments", {name:`实验 ${name}`,benchmarkId:benchmark.id,model:"菜单模型@1",team:"工具栏验证"});
  await page.goto("/projects/demo/evaluations");
  await page.getByRole("button", {name:"评测基准筛选",exact:true}).click();
  await page.getByRole("textbox", {name:"搜索评测基准筛选",exact:true}).fill(benchmark.name);
  await page.getByRole("button", {name:"选择评测基准筛选",exact:true}).click();
  await page.getByRole("menuitemradio", {name:benchmark.name,exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`benchmarkId=${benchmark.id}`));
  await expect(page.getByRole("link", {name:experiment.name,exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:"评测基准筛选",exact:true})).toBeFocused();
  if(process.env.PLATFORM_REVIEW_SCREENSHOTS === "1") {
    const directory = resolve(process.cwd(), "../../.data/ui-review-platform-console");mkdirSync(directory,{recursive:true});
    const ready = async () => {
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(() => !Array.from(document.querySelectorAll(".platform-selector-status")).some(element => element.textContent?.includes("正在加载")));
    };
    const screenshot = async (name:string,width:number) => {
      await ready();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      for(const rectangle of await page.locator('[role="menu"], [role="dialog"]').evaluateAll(elements => elements.map(element=>({left:element.getBoundingClientRect().left,right:element.getBoundingClientRect().right})))) {
        expect(rectangle.left).toBeGreaterThanOrEqual(-1);expect(rectangle.right).toBeLessThanOrEqual(width+1);
      }
      await page.screenshot({path:resolve(directory,`${name}-${width}.png`),fullPage:true});
    };
    const feedback = await post("/feedback", {title:`问题 ${name}`,datasetId:dataset.id,sampleId:dataset.samples[0].id,evidence:"用于核验实际编辑表单的隔离测试证据"});
    for(const width of [1440,390]) {
      await page.setViewportSize({width,height:1000});
      await page.goto("/projects/demo/datasets");await page.getByRole("button",{name:"按模态筛选",exact:true}).click();await page.getByRole("menu",{name:"按模态筛选",exact:true}).waitFor();await screenshot("dataset-modality-menu",width);await page.keyboard.press("Escape");
      await page.locator('.platform-page-heading').getByRole("button",{name:"导入数据",exact:true}).click();await page.getByRole("dialog").waitFor();await screenshot("dataset-create-form",width);
      await page.goto(`/projects/demo/datasets/${dataset.id}?version=${version.id}`);await page.getByRole("button",{name:"选择数据版本",exact:true}).click();await page.getByRole("menu",{name:"选择数据版本",exact:true}).waitFor();await screenshot("dataset-version-menu",width);await page.keyboard.press("Escape");
      await page.goto(`/projects/demo/evaluations?benchmarkId=${benchmark.id}`);await page.getByRole("button",{name:"评测基准筛选",exact:true}).click();await page.getByRole("textbox",{name:"搜索评测基准筛选",exact:true}).fill(benchmark.name);await screenshot("evaluation-filter-search",width);
      await page.getByRole("button",{name:"选择评测基准筛选",exact:true}).click();await page.getByRole("menuitemradio",{name:benchmark.name,exact:true}).waitFor();await screenshot("evaluation-filter-menu",width);await page.keyboard.press("Escape");await page.keyboard.press("Escape");
      await page.locator('.platform-page-heading').getByRole("button",{name:"新建实验",exact:true}).click();await page.getByRole("dialog").waitFor();await screenshot("evaluation-create-form",width);
      await page.goto(`/projects/demo/feedback/${feedback.id}`);await page.getByRole("button",{name:"更新处置状态",exact:true}).click();await page.getByRole("dialog").waitFor();await screenshot("feedback-edit-form",width);
    }
  }
});
