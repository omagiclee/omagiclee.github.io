const { chromium } = require('../../node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const url = 'http://127.0.0.1:8766';
const root = __dirname;

(async () => {
  const browser = await chromium.launch({headless:true,executablePath:chromium.executablePath()});
  const page = await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(()=>document.querySelector('#connection').textContent==='物理仿真在线');
  await page.waitForFunction(()=>document.querySelector('#frame').naturalWidth===960);
  const state = () => page.request.get(url+'/api/state').then(r=>r.json());
  const waitState = async predicate => {
    for(let i=0;i<100;i++){const s=await state();if(predicate(s))return s;await page.waitForTimeout(100);}
    throw new Error('Simulation state timeout');
  };
  await page.locator('#reset').click();await waitState(s=>!s.paused&&s.sim_seconds<1);
  await page.locator('#pause').click();
  const paused=await waitState(s=>s.paused);
  await page.waitForTimeout(300);
  assert.equal((await state()).sim_seconds,paused.sim_seconds);
  await page.locator('#reset').click();await waitState(s=>!s.paused);
  await page.waitForFunction(()=>!document.querySelector('#load').disabled);
  await page.locator('#load').click();await waitState(s=>s.mode==='trained'&&s.checkpoint);
  await page.locator('#vx').fill('0.4');await waitState(s=>Math.abs(s.command[0]-.4)<1e-6);
  await page.locator('h1').click();await page.keyboard.down('a');await waitState(s=>s.command[2]===.6);
  await page.keyboard.up('a');await waitState(s=>s.command[2]===0);
  await page.locator('#controller').selectOption('standing');await waitState(s=>s.mode==='standing');
  await page.locator('#budget').selectOption('8192');await page.locator('#seed').fill('43');
  await page.locator('#train').click();
  let run;
  for(let i=0;i<100;i++){const t=await page.request.get(url+'/api/training').then(r=>r.json());run=t.active_run;if(run)break;await page.waitForTimeout(100);}
  assert(run,'UI did not start PPO');
  const conflict=await page.request.post(url+'/api/train',{data:{steps:8192,seed:43}});assert.equal(conflict.status(),409);
  let completed;
  for(let i=0;i<180;i++){const t=await page.request.get(url+'/api/training').then(r=>r.json());completed=t.runs.find(r=>r.run_id===run);if(completed?.status==='completed')break;if(completed?.status==='failed')throw new Error(completed.error);await page.waitForTimeout(500);}
  assert.equal(completed.status,'completed');assert.equal(completed.steps,8192);assert(completed.has_model);assert(completed.evaluation);
  assert.equal(completed.evaluation.policy.episodes.length,3);
  await page.waitForFunction(()=>document.querySelector('#checkpoint').options.length>=2);
  await page.locator('#checkpoint').selectOption(run);await page.locator('#load').click();await waitState(s=>s.checkpoint===run);
  const download=await page.request.get(url+`/api/runs/${run}/model`);assert.equal(download.status(),200);assert((await download.body()).length>10000);
  const invalid=await page.request.post(url+'/api/control',{data:{vx:500}});assert.equal(invalid.status(),422);
  const foreign=await page.request.post(url+'/api/control',{headers:{origin:'https://example.com'},data:{action:'reset'}});assert.equal(foreign.status(),403);
  await page.locator('#resume').check();await page.locator('#train').click();
  let resumed;
  for(let i=0;i<100;i++){const t=await page.request.get(url+'/api/training').then(r=>r.json());resumed=t.active_run;if(resumed)break;await page.waitForTimeout(100);}
  assert(resumed&&resumed!==run);
  await page.locator('#stop').click();
  let stopped;
  for(let i=0;i<180;i++){const t=await page.request.get(url+'/api/training').then(r=>r.json());stopped=t.runs.find(r=>r.run_id===resumed);if(['stopped','completed'].includes(stopped?.status))break;await page.waitForTimeout(300);}
  assert.equal(stopped.status,'stopped');assert(stopped.has_model);assert(stopped.model_total_steps>8192);
  assert(stopped.steps<8192);
  await page.locator('#resume').uncheck();
  await page.locator('#controller').selectOption('standing');await page.locator('#reset').click();await page.locator('#zero').click();
  await waitState(s=>s.mode==='standing'&&!s.paused);
  await page.waitForTimeout(2000);
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  await page.screenshot({path:path.join(root,'artifacts/desktop.png'),fullPage:true});
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.waitForTimeout(300);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`Overflow at ${width}px`);
    await page.screenshot({path:path.join(root,`artifacts/mobile-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  const report={browser:'isolated headless Chromium',render:'960×540 native MuJoCo',checks:['pause/reset','load PPO','velocity controls','keyboard controls','UI PPO run','duplicate training rejected','held-out evaluation','model download','input validation','same-origin mutation guard','resume and graceful stop','390px and 320px layout'],run,steps:completed.steps,training_steps_per_second:completed.steps_per_second,console_errors:errors};
  fs.writeFileSync(path.join(root,'artifacts/browser-acceptance.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
