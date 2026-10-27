import {expect,test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const api=`http://127.0.0.1:${process.env.E2E_API_PORT??8010}`;

test('video training UI runs real CPU updates, checkpoints and verified model registration',async({page},testInfo)=>{
 const directory=mkdtempSync(join(tmpdir(),'flywheel-training-browser-'));
 try{
  const video=join(directory,'train.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=64x64:rate=8','-t','2','-c:v','libx264','-threads','1','-y',video]);
  await page.goto('/projects/demo/training');await expect(page.getByRole('heading',{name:'视频训练平台',exact:true})).toBeVisible();
  const me=await(await page.request.get(`${api}/api/me`)).json();const headers={'X-CSRF-Token':me.csrf_token};
  const upload=await page.request.post(`${api}/api/media/uploads?project_id=demo&filename=training.mp4`,{headers:{...headers,'Content-Type':'video/mp4'},data:readFileSync(video)});expect(upload.status(),await upload.text()).toBe(201);const object=await upload.json();
  const name=`浏览器视频训练 ${Date.now()}`;
  const response=await page.request.post(`${api}/api/data-platform/datasets?project_id=demo`,{headers,data:{name,modality:'视频',purpose:'原始预训练',qualityProfile:'raw-pretrain-v1',samples:[{name:'moving camera',input:'真实采样视频',split:'train',assets:[{kind:'video',uri:object.object_uri}]}]}});expect(response.status(),await response.text()).toBe(201);const dataset=await response.json();
  const published=await page.request.post(`${api}/api/data-platform/datasets/${dataset.id}/versions?project_id=demo`,{headers,data:{expectedRevision:dataset.revision,description:'训练固定视频版本'}});expect(published.status(),await published.text()).toBe(201);const version=await published.json();
  await page.locator('.platform-page-heading').getByRole('button',{name:'新建训练',exact:true}).click();const form=page.getByRole('dialog');await form.getByLabel('任务名称',{exact:true}).fill(name);await form.getByLabel('模型名称',{exact:true}).fill(`predictor-${Date.now()}`);
  await form.getByLabel('搜索视频数据集',{exact:true}).fill(name);await expect(form.getByRole('option',{name,exact:true})).toBeAttached();await form.getByLabel('视频数据集',{exact:true}).selectOption(dataset.id);await expect(form.getByRole('option',{name:/v1 · train 1/})).toBeAttached();await form.getByLabel('已发布数据版本',{exact:true}).selectOption(version.id);await form.getByLabel('训练轮数').fill('2');
  const createdPromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/data-platform/training/jobs');await form.getByRole('button',{name:'保存训练配置'}).click();const created=await(await createdPromise).json();await expect(form).toHaveCount(0);
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();await page.getByRole('button',{name:'开始训练',exact:true}).click();await expect(page.getByText('任务已排队，由训练 Worker 执行。')).toBeVisible();
  execFileSync(resolve('../../.venv/bin/python'),['-m','app.video_training_worker','--once'],{cwd:resolve('../../'),env:{...process.env,PYTHONPATH:resolve('../api'),DATABASE_URL:process.env.E2E_DATABASE_URL,FLYWHEEL_OBJECT_BACKEND:'local',FLYWHEEL_OBJECT_ROOT:process.env.E2E_OBJECT_ROOT,FLYWHEEL_MEDIA_ROOT:process.env.E2E_MEDIA_ROOT},timeout:30000});
  await expect.poll(async()=>(await(await page.request.get(`${api}/api/data-platform/training/jobs/${created.id}?project_id=demo`)).json()).runtimeStatus).toBe('completed');
  const status=page.getByRole('button',{name:'训练状态',exact:true});await status.focus();await page.keyboard.press('Enter');await page.getByRole('menuitemradio',{name:'已完成',exact:true}).focus();await page.keyboard.press('Enter');await expect(status).toBeFocused();
  const backend=page.getByRole('button',{name:'训练执行方式',exact:true});await backend.focus();await page.keyboard.press('Enter');await page.getByRole('menuitemradio',{name:'本机 CPU',exact:true}).focus();const filtered=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/data-platform/training/jobs'&&url.searchParams.get('status')==='completed'&&url.searchParams.get('backend')==='local-cpu';});await page.keyboard.press('Enter');await expect(backend).toBeFocused();const filteredResponse=await filtered;expect(filteredResponse.ok()).toBe(true);expect(new URL(filteredResponse.url()).searchParams.get('project_id')).toBe('demo');expect(new URL(filteredResponse.url()).searchParams.has('cursor')).toBe(false);await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'刷新训练任务'}).click();await page.getByRole('tab',{name:'指标与日志',exact:true}).click();await expect(page.getByRole('img',{name:/loss 曲线/})).toBeVisible();await expect(page.getByText(/CPU epoch=2 complete/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('real-video-training-metrics.png'),fullPage:true});await page.getByRole('tab',{name:'检查点与模型',exact:true}).click();const artifact=await page.request.get(await page.getByRole('link',{name:'下载模型产物'}).getAttribute('href') as string);expect(artifact.ok(),await artifact.text()).toBeTruthy();const model=await artifact.json();expect(model.schema).toBe('flywheel.video-next-frame.v1');expect(model.optimizerSteps).toBeGreaterThan(0);expect(model.weights.flat().some((value:number)=>Math.abs(value)>.01)).toBeTruthy();
  await page.getByRole('link',{name:'创建模型评测'}).click();await expect(page.getByRole('dialog',{name:'新建评测实验'})).toBeVisible();await expect(page.getByRole('combobox',{name:'已登记模型'})).toHaveValue((await(await page.request.get(`${api}/api/data-platform/training/jobs/${created.id}`)).json()).modelId);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
