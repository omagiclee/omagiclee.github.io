(() => {
  const selected = new Map(), pending = new Set(), collapsed = new Set();
  const groups = {
    A:'购物搜索／购物车／团购与福利', B:'延保与售后说明', C:'设备状态与软件设置', D:'天气／锁屏／日历',
    E:'新闻资讯／阅读／短视频', F:'考试练习题', G:'招聘／工作／日程', H:'账单／账户／凭证与财务资料',
    I:'AI回答／配置／命名建议', J:'聊天／短信／朋友圈', K:'医疗／护理／儿童健康', L:'运动／步数／体重记录',
    M:'生活服务／旅行交通', N:'普通图片／空白或不清画面', O:'人物／合影', P:'风景／建筑', Q:'宠物／动物', R:'美食／餐饮'
  };
  let busy = false, selectionScope = '', fetchScope = '';
  const selectable = photo => photo.deletion_version && photo.review !== 'keep';
  const labelOf = photo => photo.content_review?.label || photo.filename;
  const captionOf = photo => photo.content_review?.short_description || photo.content_review?.description || `${photo.media_type_label}，${photo.category_label}。`;
  function groupOf(photo) {
    const review=photo.content_review || {}, category=photo.custom_category || photo.category || review.category;
    if (!photo.custom_category && groups[review.cleanup_group]) return review.cleanup_group;
    const text=[review.description,...(review.tags || [])].join(' ');
    if (['invoice','order','credential'].includes(category)) return 'H';
    if (category==='people') return 'O';
    if (category==='scenery' || category==='interior') return 'P';
    if (category==='animal') return 'Q';
    if (category==='food') return 'R';
    if (category==='other' || category==='artwork' || category==='meme') return 'N';
    if (/延保|碎屏|全保修|理赔|不保范围|售后/.test(text)) return 'B';
    if (/步数|体重|体脂|跑步|骑行|运动记录|训练数据/.test(text)) return 'L';
    if (/医院|医生|挂号|门诊|牙科|涂氟|窝沟|鼻炎|湿疹|睡眠指南|体检套餐/.test(text)) return 'K';
    if (category==='product' || /购物车|商品搜索|商品筛选|团购|福利兑换|待评价/.test(text)) return 'A';
    if (/账单|交易明细|纳税|年报|持股|股权|论文.*接收|论文决定|证券|国债|账户|银行卡|订阅确认|配送订单|物流|代金券|国补资格/.test(text)) return 'H';
    if (category==='chat') return /ChatGPT|Gemini/.test(text) ? 'I' : 'J';
    if (/章节练习|情景判断|图形推理|数字推理|答题卡|练习题/.test(text)) return 'F';
    if (/招聘|职位|岗位要求|考勤|面试|教师资质/.test(text)) return 'G';
    if (/ChatGPT|Gemini|花名|人格测试/.test(text)) return 'I';
    if (/天气|锁屏|日历/.test(text)) return 'D';
    if (/新闻|资讯|文章|短视频|小说|信息流/.test(text)) return 'E';
    if (/地图|路线|车次|租房|餐馆|商户|活动规则/.test(text)) return 'M';
    return category==='interface' ? 'C' : 'N';
  }
  function groupedPhotos() {
    const result=new Map();
    for (const photo of state.photos) {const key=groupOf(photo);if(!result.has(key))result.set(key,[]);result.get(key).push(photo);}
    return [...result].sort(([a],[b])=>a.localeCompare(b)).map(([key,photos])=>[
      key,photos.sort((a,b)=>labelOf(a).localeCompare(labelOf(b),'zh-CN',{numeric:true}))
    ]);
  }
  async function fetchPage(append) {
    const scope=JSON.stringify([state.cleanupTab,state.source]);
    const same=scope===fetchScope;fetchScope=scope;
    const buckets=state.cleanupTab==='pending'?['candidate','uncertain']:[state.cleanupTab];
    const results=await Promise.all(buckets.map(async bucket=>{
      const old=same?state.photos.filter(p=>['all','retained'].includes(bucket)||p.content_review?.recommendation===bucket):[];
      const start=append?old.length:0, budget=append?200:Math.max(200,old.length);
      let photos=[],first;
      for(let offset=start;offset<start+budget;offset+=200){
        const params=new URLSearchParams({view:'cleanup',ai_review:bucket==='retained'?'all':bucket,limit:String(Math.min(200,start+budget-offset)),offset:String(offset)});
        if(bucket!=='all')params.set('review',bucket==='retained'?'keep':'unreviewed');
        const page=await api(`/api/photos?${params}`);first ||= page;photos.push(...page.photos);
        if(offset+page.photos.length>=page.count || !page.photos.length)break;
      }
      return {...first,photos};
    }));
    return {...results[0],photos:results.flatMap(r=>r.photos),count:results.reduce((n,r)=>n+r.count,0)};
  }
  function togglePhotos(photos, checked) {
    if(busy || pending.size)return;
    const eligible=photos.filter(selectable), missing=eligible.filter(p=>!selected.has(p.id));
    if(checked && selected.size+missing.length>500){toast('每次最多选择 500 张，请分批处理。');selectionUI();return;}
    eligible.forEach(photo=>{if(checked)selected.set(photo.id,{id:photo.id,version:photo.deletion_version});else selected.delete(photo.id);});
    selectionUI();
  }
  function selectionUI() {
    const locked=busy||pending.size>0;
    $('#cleanup-selection-count').textContent=selected.size?`已选 ${selected.size} 张`:'未选择图片';
    $('#cleanup-delete-selected').textContent=selected.size?`删除所选 ${selected.size} 张`:'删除所选';
    $('#cleanup-delete-selected').disabled=locked||!selected.size;
    $('#cleanup-clear-selection').disabled=locked||!selected.size;
    const loaded=state.photos.filter(selectable), count=loaded.filter(p=>selected.has(p.id)).length;
    const all=$('#cleanup-select-loaded');all.checked=loaded.length>0&&count===loaded.length;all.indeterminate=count>0&&count<loaded.length;all.disabled=locked||!loaded.length||loaded.length>500;
    $('#cleanup-select-loaded-label').textContent=`全选已加载（${loaded.length}）`;
    const byID=new Map(state.photos.map(p=>[p.id,p]));
    document.querySelectorAll('.cleanup-card').forEach(card=>{
      const photo=byID.get(card.dataset.id), input=card.querySelector('.cleanup-select input');
      input.checked=selected.has(card.dataset.id);input.disabled=locked||!selectable(photo)||(selected.size>=500&&!input.checked);
      card.classList.toggle('is-selected',input.checked);
      card.querySelectorAll('.cleanup-action,.cleanup-undo-action').forEach(button=>{button.disabled=locked||button.dataset.inactive==='true';});
    });
    for(const [key,photos] of groupedPhotos()){
      const eligible=photos.filter(selectable),checked=eligible.filter(p=>selected.has(p.id)).length,input=document.querySelector(`[data-select-group="${key}"]`);
      if(input){input.checked=eligible.length>0&&checked===eligible.length;input.indeterminate=checked>0&&checked<eligible.length;input.disabled=locked||!eligible.length||eligible.length>500;}
    }
    $('#cleanup-more').disabled=locked;
    document.querySelectorAll('[data-cleanup-tab]').forEach(button=>button.disabled=locked);
  }
  async function remove(items) {
    if(busy||pending.size||!items.length)return;
    busy=true;selectionUI();
    try{
      const result=await api('/api/delete-batch',{items}), deleted=new Set(result.deleted_ids);
      state.photos=state.photos.filter(p=>!deleted.has(p.id));state.count=Math.max(0,state.count-deleted.size);
      deleted.forEach(id=>selected.delete(id));paint();await refreshCounts();
      const failed=result.failed?.length||0;
      toast(failed?`已删除 ${deleted.size} 张，${failed} 张未完成：${result.failed[0].error}`:`已将 ${deleted.size} 张移到${result.destination==='recently_deleted'?'最近删除':'废纸篓'}。`);
    }catch(error){toast(error.message);}
    finally{busy=false;selectionUI();}
  }
  async function decide(photo,value) {
    if(busy||pending.size)return;
    if(value==='delete')return remove([{id:photo.id,version:photo.deletion_version}]);
    pending.add(photo.id);selectionUI();
    try{
      await api('/api/review',{ids:[photo.id],review:value});photo.review=value;selected.delete(photo.id);
      if((value==='keep'&&!['all','retained'].includes(state.cleanupTab))||(value==='unreviewed'&&state.cleanupTab==='retained')){
        state.photos=state.photos.filter(p=>p.id!==photo.id);state.count=Math.max(0,state.count-1);
      }
      paint();await refreshCounts();
    }
    catch(error){toast(error.message);}
    finally{pending.delete(photo.id);selectionUI();}
  }
  function makeCard(photo) {
    const review=photo.content_review,description=captionOf(photo),label=labelOf(photo),card=node('article','cleanup-card');card.dataset.id=photo.id;
    const pick=node('label','cleanup-select'),checkbox=node('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',`选择 ${label}`);
    checkbox.addEventListener('change',()=>togglePhotos([photo],checkbox.checked));pick.append(checkbox);
    const preview=node('button','cleanup-card-preview');preview.type='button';preview.setAttribute('aria-label',`放大查看 ${label}`);
    if(photo.has_preview){const image=node('img');image.src=`/api/preview/${photo.id}?size=large`;image.alt=description;image.loading='lazy';image.decoding='async';image.addEventListener('error',()=>preview.replaceChildren(placeholder('暂无预览')),{once:true});preview.append(image);}else preview.append(placeholder('暂无预览'));
    preview.addEventListener('click',()=>openPhoto(state.photos.findIndex(p=>p.id===photo.id)));
    const body=node('div','cleanup-card-body'),copy=node('div','cleanup-card-copy'),meta=node('div','cleanup-row-meta');
    meta.append(node('span','cleanup-reference',label));
    const decision=photo.review==='keep'?'已保留':({candidate:'清理候选',uncertain:'用途待确认',keep:'建议保留'}[review?.recommendation]||'待审看');
    meta.append(node('span',`cleanup-recommendation ${photo.review==='keep'?'keep':review?.recommendation||'uncertain'}`,decision));
    copy.append(meta,node('p','cleanup-description',description));
    if(review?.short_description && review.description!==description){const details=node('details','cleanup-full-description');details.append(node('summary','','完整描述'),node('p','',review.description));copy.append(details);}
    const actions=node('div','cleanup-card-actions');
    for(const [value,text] of [['keep','保留'],['delete','删除']]){
      const active=value==='keep'&&photo.review===value,button=node('button',`cleanup-action ${value}${active?' selected':''}`,active?'✓ 已保留':text);button.type='button';button.setAttribute('aria-pressed',String(active));button.addEventListener('click',()=>decide(photo,value));actions.append(button);
    }
    const undo=node('button','cleanup-undo-action','撤销保留');undo.type='button';undo.dataset.inactive=String(photo.review!=='keep');undo.hidden=photo.review!=='keep';undo.addEventListener('click',()=>decide(photo,'unreviewed'));actions.append(undo);
    body.append(copy,actions);card.append(pick,preview,body);return card;
  }
  function setCollapsed(key,value){
    if(value)collapsed.add(key);else collapsed.delete(key);
    const section=document.getElementById(`cleanup-group-${key}`);if(!section)return;
    section.querySelector('.cleanup-group-rows').hidden=value;section.querySelector('.cleanup-group-toggle').setAttribute('aria-expanded',String(!value));
  }
  function paint(){
    const grid=$('#cleanup-grid'),nav=$('#cleanup-groups');grid.replaceChildren();nav.replaceChildren();
    for(const [key,photos] of groupedPhotos()){
      const section=node('section','cleanup-group');section.id=`cleanup-group-${key}`;section.dataset.group=key;
      const header=node('div','cleanup-group-heading'),heading=node('h2'),toggle=node('button','cleanup-group-toggle');toggle.type='button';toggle.setAttribute('aria-expanded',String(!collapsed.has(key)));toggle.setAttribute('aria-controls',`cleanup-rows-${key}`);
      toggle.append(node('span','cleanup-group-letter',key),node('span','',groups[key]),node('span','cleanup-group-count',`${photos.length} 张`));toggle.addEventListener('click',()=>setCollapsed(key,!collapsed.has(key)));heading.append(toggle);
      const pick=node('label','cleanup-group-select'),check=node('input');check.type='checkbox';check.dataset.selectGroup=key;check.setAttribute('aria-label',`选择 ${groups[key]} 组已加载图片`);check.addEventListener('change',()=>togglePhotos(photos,check.checked));pick.append(check,node('span','','选本组'));
      header.append(heading,pick);const rows=node('div','cleanup-group-rows');rows.id=`cleanup-rows-${key}`;rows.hidden=collapsed.has(key);photos.forEach(p=>rows.append(makeCard(p)));section.append(header,rows);grid.append(section);
      const link=node('button','cleanup-group-link');link.type='button';link.append(node('span','',`${key} · ${groups[key]}`),node('span','',photos.length));link.addEventListener('click',()=>{setCollapsed(key,false);section.scrollIntoView({block:'start',behavior:'instant'});});nav.append(link);
    }
    $('#cleanup-loaded').textContent=`已显示 ${state.photos.length} / ${state.count} 张`;
    $('#cleanup-empty').hidden=state.photos.length>0;$('#cleanup-more').hidden=state.photos.length>=state.count;selectionUI();
  }
  async function refreshCounts(){
    const summary=await api('/api/organize');if(state.view!=='cleanup')return;
    for(const key of ['candidate','uncertain','keep'])$(`#cleanup-count-${key}`).textContent=formatNumber(summary.content_review_pending?.[key]);
    $('#cleanup-count-all').textContent=formatNumber(summary.content_reviews?.all);
    $('#cleanup-count-pending').textContent=formatNumber((summary.content_review_pending?.candidate||0)+(summary.content_review_pending?.uncertain||0));
    const decisions=summary.content_review_decisions||{};
    $('#cleanup-count-retained').textContent=formatNumber(decisions.keep);
    $('#deletion-note').textContent=state.source?.kind==='photos'?'删除会同步至 iCloud 照片，可在最近删除中恢复':'删除会移到本机废纸篓';
    $('#cleanup-progress').textContent=`已看图 ${formatNumber(summary.content_reviews?.all)} 张 · 已处理 ${formatNumber((decisions.keep||0)+(summary.deleted_count||0))} 张`;
    $('#cleanup-tabs').querySelectorAll('button').forEach(button=>{const active=state.cleanupTab===button.dataset.cleanupTab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  }
  async function render(){
    const scope=JSON.stringify([state.cleanupTab,state.source]);if(scope!==selectionScope){selected.clear();collapsed.clear();selectionScope=scope;}
    state.photos=groupedPhotos().flatMap(([,photos])=>photos);
    const current=new Map(state.photos.map(p=>[p.id,p]));
    for(const [id,item] of selected){const photo=current.get(id);if(!photo||!selectable(photo)||photo.deletion_version!==item.version)selected.delete(id);}
    paint();await refreshCounts();
  }
  $('#cleanup-select-loaded').addEventListener('change',event=>togglePhotos(state.photos,event.target.checked));
  $('#cleanup-clear-selection').addEventListener('click',()=>{selected.clear();selectionUI();});
  $('#cleanup-delete-selected').addEventListener('click',()=>remove([...selected.values()]));
  $('#cleanup-preview-size').addEventListener('change',event=>$('#cleanup-grid').classList.toggle('extra-large',event.target.value==='large'));
  $('#cleanup-collapse-all').addEventListener('click',()=>groupedPhotos().forEach(([key])=>setCollapsed(key,true)));
  $('#cleanup-expand-all').addEventListener('click',()=>groupedPhotos().forEach(([key])=>setCollapsed(key,false)));
  document.querySelectorAll('[data-cleanup-tab]').forEach(button=>button.addEventListener('click',()=>{if(busy||pending.size)return;state.cleanupTab=button.dataset.cleanupTab;load().catch(showError);}));
  $('#cleanup-more').addEventListener('click',async()=>{const button=$('#cleanup-more');button.disabled=true;try{await load(true);}catch(error){toast(error.message);}finally{button.disabled=false;}});
  window.PhotoCleanup={render,fetchPage,isBusy:()=>busy||pending.size>0};
})();
