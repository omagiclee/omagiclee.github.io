// Run against an ISOLATED dev API and Vite server. Never target production.
// Usage: NODE_PATH=/path/to/data-flywheel/node_modules node tools/capture.cjs
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.REPLICA_WEB_URL || 'http://127.0.0.1:18482';
const api = process.env.REPLICA_API_URL || 'http://127.0.0.1:18481';
const out = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chromium'});
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  const page = await context.newPage();
  const errors=[]; const shots=[];
  page.on('pageerror',e=>errors.push(e.message));
  const shot=async(name,note)=>{await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'screenshots',name+'.png'),fullPage:page.viewportSize().width>=700});shots.push({file:name+'.png',url:page.url(),viewport:page.viewportSize(),note});console.log(name);};
  const goto=async(url)=>{await page.goto(base+url);await page.getByRole('heading',{level:1}).first().waitFor();};
  try {
    await goto('/projects/demo/pipelines');
    const me=await(await context.request.get(api+'/api/me')).json();
    const post=async(url,data)=>{const r=await context.request.post(api+url,{headers:{'X-CSRF-Token':me.csrf_token},data});if(!r.ok())throw Error(url+': '+r.status()+' '+await r.text());return r.json();};
    const video=await post('/api/media/demo-pipeline?project_id=demo',{});
    const docs=await post('/api/operator-plugins/register?project_id=demo',{plugin_id:'documents.core'});
    const source=docs.operators.find(x=>x.id==='documents.inline'),filter=docs.operators.find(x=>x.id==='documents.filter');
    const textFlow=await post('/api/pipelines?project_id=demo',{name:'文本小样本流水线',description:'固定文档 → 过滤 → 候选数据集',graph:{nodes:[{id:'documents',operator:source.id,version:source.version,inputs:{},config:{...source.default_config,records:[{id:'sample-1',text:'用于流程复刻验收的文档',metadata:{}},{id:'sample-2',text:'第二条固定文档',metadata:{}}]}},{id:'filter',operator:filter.id,version:filter.version,inputs:{data:'documents'},config:filter.default_config}]}});
    await goto('/projects/demo/pipelines');await page.getByRole('link',{name:'文本小样本流水线',exact:true}).waitFor();await shot('01-pipeline-directory','真实临时 API 数据；无生产运行');
    await goto('/projects/demo/pipelines?view=new');await shot('02-pipeline-new','空白流程');
    await goto('/projects/demo/pipelines?view=new&template=video');await shot('03-video-template','视频模板输入');
    await goto('/projects/demo/pipelines?view=new&template=text');await shot('04-text-template','文本模板输入');
    await goto('/projects/demo/pipelines?pipelineId='+video.id+'&view=builder');await page.getByRole('button',{name:'适配全部节点',exact:true}).click();await shot('05-video-builder','真实七节点视频定义，未执行模型');
    await page.getByRole('button',{name:'配置节点 autoshot',exact:true}).click();await shot('06-node-parameters','节点参数与小样本调试控件');
    await page.getByRole('button',{name:'使用 JSON 编辑',exact:true}).click();await shot('07-node-json','完整配置 JSON 编辑');
    await page.getByRole('button',{name:'更多流程操作',exact:true}).click();await shot('08-editor-menu','导入导出与缓存开关');await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'版本',exact:true}).click();await page.getByText('只读版本',{exact:true}).waitFor();await shot('09-version','历史只读定义');
    await page.getByText('生产部署与触发',{exact:true}).click();await page.getByLabel('部署触发方式').selectOption('interval');await shot('10-deployment','部署修订表单，未创建触发器');
    await goto('/projects/demo/operators');await page.getByRole('heading',{name:source.name,exact:true}).waitFor();await shot('11-operator-library','真实预装算子库');
    await page.getByRole('button',{name:'启用插件',exact:true}).click();await page.getByRole('dialog').waitFor();await shot('12-plugin-enable','项目插件启用对话框');await page.getByRole('button',{name:'关闭插件启用窗口'}).click();
    await goto('/projects/demo/operators?view=development');await page.getByRole('heading',{name:'创建第一个插件版本',exact:true}).waitFor();await shot('13-plugin-development-empty','插件开发空状态');
    await page.getByRole('button',{name:'新建插件版本',exact:true}).click();await page.getByRole('dialog').waitFor();await shot('14-plugin-upload','真实上传表单，未上传 wheel');await page.getByRole('button',{name:'关闭新建插件版本'}).click();
    const manifest={id:'example.documents',name:'文档筛选插件',version:'1.0.0',description:'用于复刻截图的合成夹具',sdk_version:'1',operators:[{...filter,id:'example.filter',plugin_id:undefined,implementation_digest:undefined}]};
    const cases=[{name:'保留符合条件的文档',operator_id:'example.filter',config:{},input:{type:'documents',records:[]},expected:{type:'documents',records:[{id:'sample-1',text:'符合条件的文档'}]}}];
    let release={id:'fixture-release',project_id:'demo',plugin_id:manifest.id,version:'1.0.0',manifest,test_cases:cases,wheel_filename:'example_documents-1.0.0-py3-none-any.whl',wheel_sha256:'a'.repeat(64),runtime_digest:'sha256:'+'b'.repeat(64),sdk_bundle_digest:'c'.repeat(64),status:'validation_failed',validation_id:'fixture-validation',validation_status:'failed',deployment_state:'ready',active:false,created_at:'2026-10-28T01:00:00Z',published_at:null};
    const validation={id:'fixture-validation',release_id:release.id,status:'failed',created_at:'2026-10-28T01:01:00Z',started_at:'2026-10-28T01:01:01Z',finished_at:'2026-10-28T01:01:03Z',error:null,report:{checks:[{name:'wheel_contract',passed:true},{name:cases[0].name,operator_id:'example.filter',passed:false,message:'Output does not match expected result',output:{type:'documents',records:[]}}],logs:'Screenshot fixture only. No wheel was executed.'}};
    await page.route('**/api/plugin-releases**',async route=>{const u=new URL(route.request().url());if(route.request().method()!=='GET')return route.abort();let data=u.pathname.endsWith('/validations')?[validation]:u.pathname.endsWith('/fixture-release')?release:{items:[release],total:1,offset:0,limit:20,has_more:false};await route.fulfill({json:data});});
    await goto('/projects/demo/operators?view=development&releaseId=fixture-release');await page.getByRole('region',{name:'插件版本详情'}).waitFor();await page.getByText('查看预期与实际结果',{exact:true}).click();await shot('15-plugin-validation-fixture','合成失败报告，仅展示真实组件的条件状态');
    release={...release,status:'published',validation_status:'passed',active:true,published_at:'2026-10-28T01:02:00Z'};
    validation.status='passed';validation.report.checks[1].passed=true;validation.report.checks[1].message='Output matches the expected artifact';validation.report.checks[1].output=cases[0].expected;
    await page.reload();await page.getByText('可以开始编排',{exact:true}).waitFor();await shot('16-plugin-published-fixture','合成已发布并启用状态；不表示真实发布');
    const artifact={id:'fixture-artifact',run_id:'fixture-run',node_id:'filter',type:'documents',record_count:1,content_hash:'d'.repeat(64),metadata:{execution_mode:'production'},records:[{id:'sample-1',text:'用于流程复刻验收的文档'}],parent_artifact_ids:[],cache_origin_id:null,created_at:'2026-10-28T01:00:03Z'};
    const run={id:'fixture-run',pipeline_id:textFlow.id,pipeline_name:textFlow.name,pipeline_version:1,status:'succeeded',created_at:'2026-10-28T01:00:00Z',finished_at:'2026-10-28T01:00:03Z',error:null,mode:'production',tasks:textFlow.graph.nodes.map((n,i)=>({id:'fixture-task-'+i,node_id:n.id,operator:n.operator,status:'succeeded',input_count:i?2:0,output_count:i?1:2,duration_ms:1200,error:null,artifact_id:i?artifact.id:null})),artifacts:[artifact],operator_snapshot:docs.operators,execution_plan:{mode:'production',version:1,targets:[],node_ids:['documents','filter'],graph:textFlow.graph,semantic_digest:'e'.repeat(64),plan_digest:'f'.repeat(64),sample:{limit:null,fixed:true,sources:[{node_id:'documents',record_ids:['sample-1','sample-2'],record_count:2,content_hash:'1'.repeat(64)}]},warnings:[],blocked:[]}};
    await page.route('**/api/pipeline-runs**',async route=>{const u=new URL(route.request().url());await route.fulfill({json:u.pathname.endsWith('/fixture-run')?run:u.searchParams.has('paginated')?{items:[run],total:1,offset:0,limit:20,has_more:false}:[run]});});
    await page.route('**/api/pipeline-artifacts/fixture-artifact**',route=>route.fulfill({json:artifact}));
    await goto('/projects/demo/pipelines?pipelineId='+textFlow.id+'&view=runs&runId=fixture-run');await page.getByRole('button',{name:'检查节点 filter',exact:true}).click();await page.getByRole('region',{name:'候选数据集交付'}).waitFor();await shot('17-run-artifact-fixture','合成运行与文档产物，展示检查和候选交付；未执行正式运行');
    await page.setViewportSize({width:390,height:844});await goto('/projects/demo/pipelines?pipelineId='+video.id+'&view=builder');await page.getByRole('button',{name:'参数',exact:true}).click();await page.getByRole('dialog',{name:'配置参数'}).waitFor();await page.getByLabel('选择配置节点').selectOption('autoshot');await shot('18-mobile-parameters','390px 窄屏参数抽屉');
    await fs.writeFile(path.join(out,'fixtures','visual-fixtures.json'),JSON.stringify({release,validation,run,artifact},null,2));
    await fs.writeFile(path.join(out,'verification','screenshots.json'),JSON.stringify({base,api,isolatedDatabase:true,pageErrors:errors,screenshots:shots},null,2));
    if(errors.length)throw Error('Page errors: '+errors.join('; '));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
