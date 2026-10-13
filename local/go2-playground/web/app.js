const $ = id => document.getElementById(id);
let live = {}, training = {}, selectedRun = '', historyKey = '', chartPoints = [], connected = false, lastActiveRun = null;
const names = {starting:'启动中',running:'训练中',evaluating:'评估中',completed:'已完成',stopped:'已停止',failed:'训练失败',interrupted:'已中断'};
const modes = {standing:'站姿参考控制',random:'随机动作探索',trained:'PPO 训练策略'};
let toastTimer;
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,4500); }
async function api(path, body) {
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok) {let detail;try{detail=(await response.json()).detail;}catch{}throw new Error(typeof detail==='string'?detail:`请求失败 (${response.status})`);}
  return response.json();
}
function act(body) { return api('/api/control',body).catch(e=>toast(e.message)); }
function format(value,digits=1) {return value==null?'—':Number(value).toFixed(digits);}
function escapeText(value) {const e=document.createElement('span');e.textContent=String(value);return e.innerHTML;}
function setCommand(vx,vy,yaw) {
  $('vx').value=vx;$('vy').value=vy;$('yaw').value=yaw;updateOutputs();return act({vx,vy,yaw});
}
function updateOutputs() {for(const id of ['vx','vy','yaw'])$(id+'-value').textContent=Number($(id).value).toFixed(2)+(id==='yaw'?' rad/s':' m/s');}
for(const id of ['vx','vy','yaw'])$(id).addEventListener('input',()=>{updateOutputs();act({[id]:Number($(id).value)});});
$('zero').onclick=()=>setCommand(0,0,0);
$('pause').onclick=()=>act({action:'toggle'});
$('reset').onclick=()=>act({action:'reset'});
$('push').onclick=()=>act({action:'push'});
$('camera').onchange=()=>act({azimuth:Number($('camera').value)});
$('controller').onchange=()=>{if($('controller').value!=='trained')act({mode:$('controller').value});};
$('load').onclick=async()=>{const id=$('checkpoint').value;if(id){await act({checkpoint:id});toast('正在载入 PPO 策略');}};
$('train').onclick=async()=>{
  const steps=Number($('budget').value), seed=Number($('seed').value), resume=$('resume').checked?$('checkpoint').value:null;
  if(!Number.isInteger(seed)||seed<0||seed>2147483647){toast('请输入有效的随机种子');return;}
  if($('resume').checked&&!resume){toast('请先选择一个已保存策略');return;}
  $('train').disabled=true;
  try{const result=await api('/api/train',{steps,seed,resume});selectedRun=result.run_id;toast('训练已启动，记录将实时更新');await pollTraining();}
  catch(e){toast(e.message);$('train').disabled=false;}
};
$('stop').onclick=async()=>{try{await api('/api/train/stop',{});toast('将在下一次采样后停止、保存并评估模型');}catch(e){toast(e.message);}};
$('checkpoint').onchange=()=>updateModelActions();
function updateModelActions(){const id=$('checkpoint').value;$('load').disabled=!id;$('download').hidden=!id;$('download').href=id?`/api/runs/${encodeURIComponent(id)}/model`:'#';}
const pressed=new Set();
function keyCommand(){setCommand(pressed.has('w')?.4:pressed.has('s')?-.3:0,0,pressed.has('a')?.6:pressed.has('d')?-.6:0);}
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.metaKey||e.ctrlKey||e.altKey)return;const k=e.key.toLowerCase();if(['w','a','s','d'].includes(k)){e.preventDefault();if(!pressed.has(k)){pressed.add(k);keyCommand();}}});
document.addEventListener('keyup',e=>{if(pressed.delete(e.key.toLowerCase()))keyCommand();});
window.addEventListener('blur',()=>{if(pressed.size){pressed.clear();keyCommand();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&pressed.size){pressed.clear();keyCommand();}});
async function pollLive(){
  try {
    live=await api('/api/state');connected=true;
    $('connection').textContent=live.ready?'物理仿真在线':'初始化中';$('connection').className='badge';
    if(live.error){$('connection').textContent='仿真异常';$('connection').className='badge error';}
    $('scene-message').textContent=live.error||live.last_error||(live.ready?(live.fallen?'机器狗跌倒了 · 重置后继续实验':live.paused?'仿真已暂停':''):live.message||'正在初始化…');
    if(live.ready){
      $('speed').innerHTML=format(live.velocity[0],2)+'<small> m/s</small>';$('height').innerHTML=format(live.height,2)+'<small> m</small>';
      $('reward').textContent=format(live.reward,2);$('sim-time').innerHTML=format(live.sim_seconds,1)+'<small> s</small>';$('fps').textContent=format(live.fps,0);
      $('mode-label').textContent=modes[live.mode];$('pause').textContent=live.paused?'继续':'暂停';
      if(live.mode==='trained'&&!$('controller').querySelector('[value="trained"]')){const option=new Option('PPO 策略 · 已载入','trained');$('controller').add(option);}
      $('controller').value=live.mode;
      $('controller-help').textContent=live.mode==='trained'?'速度指令由 PPO 策略执行。未充分训练的策略可能站立、滑动或跌倒。':live.mode==='random'?'随机关节动作展示探索过程，可能很快跌倒。':'站姿参考用 PD 控制保持姿态。速度指令需加载训练策略后生效。';
      for(const el of document.querySelectorAll('[data-foot]'))el.classList.toggle('active',live.feet[el.dataset.foot]);
    }
  }catch(e){connected=false;$('connection').textContent='连接中断';$('connection').className='badge error';$('scene-message').textContent='本地服务未连接，请检查启动终端。';}
}
let lastFrameUrl;
async function frames(){
  try{if(!document.hidden&&connected&&live.ready){const response=await fetch('/api/frame',{cache:'no-store'});if(response.ok){const url=URL.createObjectURL(await response.blob());await new Promise(resolve=>{const img=$('frame');img.onload=resolve;img.onerror=resolve;img.src=url;});if(lastFrameUrl)URL.revokeObjectURL(lastFrameUrl);lastFrameUrl=url;}}}catch{}
  setTimeout(frames,document.hidden?500:45);
}
function drawChart(){
  const canvas=$('chart'),rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  canvas.width=Math.max(1,rect.width*dpr);canvas.height=Math.max(1,rect.height*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height,left=44,right=12,top=12,bottom=27;
  const points=chartPoints.filter(p=>p.mean_episode_return!==null&&p.mean_episode_return!==undefined);
  $('chart-empty').hidden=points.length>0;
  let lo=points.length?Math.min(...points.map(p=>p.mean_episode_return)):0;
  let hi=points.length?Math.max(...points.map(p=>p.mean_episode_return)):1;
  if(hi-lo<1){hi+=1;lo-=1;}const pad=(hi-lo)*.12;hi+=pad;lo-=pad;
  const maxStep=points.length?Math.max(...points.map(p=>p.steps)):1;
  ctx.font='9px ui-monospace, monospace';ctx.lineWidth=1;
  for(let i=0;i<4;i++){const y=top+(h-top-bottom)*i/3;ctx.strokeStyle='#e9ede6';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#89958c';ctx.textAlign='right';if(points.length)ctx.fillText((hi-(hi-lo)*i/3).toFixed(0),left-8,y+3);}
  if(!points.length)return;
  const xy=points.map(p=>[left+p.steps/maxStep*(w-left-right),top+(hi-p.mean_episode_return)/(hi-lo)*(h-top-bottom)]);
  ctx.beginPath();ctx.moveTo(xy[0][0],h-bottom);for(const [x,y] of xy)ctx.lineTo(x,y);ctx.lineTo(xy.at(-1)[0],h-bottom);ctx.closePath();
  const fill=ctx.createLinearGradient(0,top,0,h-bottom);fill.addColorStop(0,'#65a88130');fill.addColorStop(1,'#65a88102');ctx.fillStyle=fill;ctx.fill();
  ctx.strokeStyle='#32845c';ctx.lineWidth=2;ctx.beginPath();xy.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
  for(const [x,y] of xy){ctx.fillStyle='#32845c';ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill();}
  ctx.fillStyle='#89958c';ctx.textAlign='left';ctx.fillText('0',left,h-7);ctx.textAlign='right';ctx.fillText(maxStep.toLocaleString()+' steps',w-right,h-7);
}
window.addEventListener('resize',drawChart);
async function pollTraining(){
  try{
    training=await api('/api/training');
    if(training.active_run&&training.active_run!==lastActiveRun)selectedRun=training.active_run;
    lastActiveRun=training.active_run;
    if(!selectedRun&&training.runs.length)selectedRun=training.runs[0].run_id;
    const selected=training.runs.find(r=>r.run_id===selectedRun)||training.runs[0];
    const active=Boolean(training.active_run);$('train').disabled=active;$('stop').disabled=!active;
    $('train-status').textContent=active?names[training.runs.find(r=>r.run_id===training.active_run)?.status]||'训练中':selected?names[selected.status]||selected.status:'尚未开始';
    $('train-status').className='badge'+(selected?.status==='failed'?' error':active?'':' neutral');
    const old=$('checkpoint').value,models=training.runs.filter(r=>r.has_model);
    const modelKey=models.map(r=>r.run_id).join(',');
    if($('checkpoint').dataset.key!==modelKey){$('checkpoint').replaceChildren();if(!models.length)$('checkpoint').add(new Option('暂无模型',''));for(const r of models)$('checkpoint').add(new Option(`${r.run_id} · ${(r.model_total_steps||r.steps||0).toLocaleString()} 步`,r.run_id));if(models.some(r=>r.run_id===old))$('checkpoint').value=old;$('checkpoint').dataset.key=modelKey;updateModelActions();}
    if(selected){
      $('progress-text').textContent=(selected.steps||0).toLocaleString()+' / '+(selected.target_steps||0).toLocaleString();
      $('progress').value=Math.min((selected.steps||0)/(selected.target_steps||1),1);
      $('train-speed').textContent=format(selected.steps_per_second,0)+' step/s';$('episode-length').textContent=format(selected.mean_episode_seconds,1)+' s';
      const key=selected.run_id+':'+selected.steps+':'+selected.status;
      if(historyKey!==key){historyKey=key;chartPoints=await api(`/api/runs/${encodeURIComponent(selected.run_id)}/history`);drawChart();}
      if(selected.evaluation){const e=selected.evaluation;$('evaluation').hidden=false;$('evaluation').innerHTML=`<strong>独立评估 · 3 个相同随机种子</strong><br>平均速度误差：PPO ${format(e.policy.mean_velocity_error,3)} / 站姿参考 ${format(e.standing_baseline.mean_velocity_error,3)} m/s（越低越好）<br>平均保持时长：PPO ${format(e.policy.mean_survival_seconds,1)} / 站姿参考 ${format(e.standing_baseline.mean_survival_seconds,1)} s（上限 6 s）`;}
      else{$('evaluation').hidden=true;}
      if(document.querySelector('details').open){$('train-log').textContent=(await api(`/api/runs/${encodeURIComponent(selected.run_id)}/log`)).text||'训练启动中…';}
    }
    if(training.runs.length){$('runs').className='';$('runs').innerHTML=training.runs.map(r=>`<div class="run-row ${r.run_id===selectedRun?'active':''}"><span class="run-id">${escapeText(r.run_id)}</span><span class="run-metric"><strong>${(r.steps||0).toLocaleString()}</strong> 步</span><span class="run-metric"><strong>${format(r.elapsed_seconds,0)}</strong> s</span><span class="badge ${r.status==='failed'?'error':'neutral'}">${names[r.status]||escapeText(r.status)}</span><button class="outline" data-run="${escapeText(r.run_id)}">查看</button></div>`).join('');}
  }catch(e){$('train-status').textContent='训练状态暂不可用';}
}
$('runs').addEventListener('click',e=>{const button=e.target.closest('[data-run]');if(button){selectedRun=button.dataset.run;historyKey='';pollTraining();}});
document.querySelector('details').addEventListener('toggle',()=>{if(document.querySelector('details').open)pollTraining();});
async function loops(){await pollLive();setTimeout(loops,document.hidden?1500:250);}
async function trainingLoop(){await pollTraining();setTimeout(trainingLoop,1500);}
async function init(){
  try{const system=await api('/api/system');if(system.chip&&system.chip!=='unknown')$('chip').textContent=system.chip;if(system.memory_bytes&&system.memory_bytes!=='unknown')$('memory').textContent=`${Math.round(Number(system.memory_bytes)/1024**3)} GB · CPU PPO`;
    if(system.environment_steps_per_second)$('benchmark').textContent=`实测纯仿真 ${system.environment_steps_per_second.toLocaleString()} step/s · 不含 PPO 更新`;
  }catch{}
  drawChart();loops();trainingLoop();frames();
}
init();
