'use strict';
const $ = selector => document.querySelector(selector);
const state = { view: location.hash === '#journeys' ? 'journeys' : location.hash === '#cleanup' ? 'cleanup' : location.hash === '#organize' ? 'all' : ['#time-map', '#footprints'].includes(location.hash) ? 'footprints' : 'all', month: '', album: '', q: '', category: '', mediaType: '', cleanupTab: 'pending', mode: 'keyword', photos: [], count: 0, token: '', source: null, phase: '', current: -1, generation: 0, busy: false };
const titles = {all:'照片', favorites:'收藏', duplicates:'重复照片', cleanup:'清理', footprints:'足迹', journeys:'旅行相册', local:'本地原图', preview:'本地预览', unavailable:'尚未下载'};
const availability = {local:'原图在本机', preview:'本地预览', unavailable:'尚未下载'};
const formatNumber = value => Number(value || 0).toLocaleString('zh-CN');
const node = (tag, className, text) => { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; };
const displayDate = value => { if (!value) return '日期不明'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }); };
let toastTimer, searchTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000); }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Photo-Token': state.token }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '本地请求未完成，请重试。');
  return result;
}
function placeholder(message) { const result = node('div', 'photo-placeholder'); result.append(node('span', '', '▧'), node('span', '', message)); return result; }
function photoImage(photo, large = false) {
  if (!photo.has_preview) return placeholder('尚未下载到本机');
  const wrapper = node('div', large ? 'large-image' : 'thumbnail');
  const image = node('img'); image.alt = photo.title || photo.filename; image.loading = large ? 'eager' : 'lazy'; image.decoding = 'async';
  image.addEventListener('error', () => { wrapper.replaceChildren(placeholder('预览暂不可用，请刷新相册后重试。')); }, { once: true });
  image.src = `/api/preview/${photo.id}${large ? '?size=large' : ''}`;
  wrapper.append(image);
  return wrapper;
}
function card(photo, index) {
  const result = node('article', 'photo-card'); result.dataset.id = photo.id;
  const open = node('button', 'photo-open'); open.type = 'button'; open.setAttribute('aria-label', `查看 ${photo.filename}`);
  const thumbnail = photo.has_preview ? photoImage(photo) : node('div', 'thumbnail');
  if (!photo.has_preview) thumbnail.append(placeholder('尚未下载'));
  if (photo.availability === 'preview') thumbnail.append(node('span', 'thumbnail-badge', '仅预览'));
  open.append(thumbnail);
  const caption = node('div', 'photo-caption'); caption.append(node('div', 'photo-name', photo.title || photo.filename));
  const sub = node('div', 'photo-subtitle'); sub.append(node('span', '', displayDate(photo.date)), node('span', '', photo.custom_album || photo.albums[0] || ''));
  caption.append(sub); open.append(caption); open.addEventListener('click', () => openPhoto(index));
  const favorite = node('button', `photo-favorite${photo.favorite ? ' selected' : ''}`, photo.favorite ? '★' : '☆'); favorite.type = 'button';
  favorite.setAttribute('aria-label', `${photo.favorite ? '取消收藏' : '收藏'} ${photo.filename}`);
  favorite.setAttribute('aria-pressed', String(photo.favorite)); favorite.addEventListener('click', async () => {
    favorite.disabled = true;
    try { await api(`/api/annotations/${photo.id}`, { favorite: !photo.favorite }); await load(); }
    catch (error) { toast(error.message); } finally { favorite.disabled = false; }
  });
  result.append(open, favorite); return result;
}
function renderGallery() {
  if (['journeys', 'footprints', 'cleanup'].includes(state.view)) { $('#gallery').hidden = $('#empty').hidden = true; $('#load-more').hidden = true; return; }
  $('#gallery').hidden = false;
  const gallery = $('#gallery'); gallery.replaceChildren(); let group = '', groupNumber = 0;
  state.photos.forEach((photo, index) => {
    if (state.view === 'duplicates' && photo.duplicate !== group) { group = photo.duplicate; groupNumber += 1; const heading = node('div', 'duplicate-heading', `第 ${groupNumber} 组重复照片`); heading.append(node('span', '', '文件内容完全相同')); gallery.append(heading); }
    const element = card(photo, index);
    gallery.append(element);
  });
  const count = state.count;
  $('#results-count').textContent = `${formatNumber(count)} 张照片${state.photos.length < count ? ` · 已显示 ${state.photos.length} 张` : ''}`;
  $('#load-more').hidden = state.photos.length >= count;
  $('#empty').hidden = count > 0;
  const hasFilters = state.view !== 'all' || state.month || state.album || state.q;
  $('#clear-filters').hidden = !(state.month || state.album || state.q || state.category || state.mediaType || ['local','preview','unavailable'].includes(state.view));
  $('#empty-source').hidden = Boolean(hasFilters) || state.busy;
  if (!count) {
    const error = state.phase === 'error';
    $('#empty-title').textContent = state.busy ? '正在整理照片…' : error ? '图库暂时无法读取' : hasFilters ? '没有符合条件的照片' : '开始整理你的照片';
    $('#empty-description').textContent = state.busy ? '正在读取本机照片信息，整理完成后会显示照片。' : error ? '请查看上方提示，或选择已导出的本地照片文件夹。' : hasFilters ? '可以换一个相册、月份或搜索词，原图仍保留在原位置。' : '连接照片图库或本地文件夹，照片文件保留在本机。';
  }
}
function renderNavigation(result) {
  const libraryView = !['cleanup','footprints','journeys'].includes(state.view);
  document.body.classList.toggle('cleanup-view', state.view === 'cleanup');
  document.body.classList.toggle('footprint-view', state.view === 'footprints');
  document.body.classList.toggle('journey-view', state.view === 'journeys');
  document.querySelectorAll('.photo-only').forEach(element => { element.hidden = !libraryView; });
  $('#cleanup-workbench').hidden = state.view !== 'cleanup';
  $('#footprint-workbench').hidden = state.view !== 'footprints';
  $('#journey-workbench').hidden = state.view !== 'journeys';
  $('#travel-tabs').hidden = !['footprints','journeys'].includes(state.view);
  if (state.view !== 'journeys') window.PhotoAmap?.deactivate();
  if (state.view !== 'footprints') window.PhotoFootprints?.deactivate();
  $('#view-title').textContent = titles[state.view] || '照片';
  $('#count-all').textContent = formatNumber(result.stats.total);
  $('#count-favorites').textContent = formatNumber(result.stats.favorites);
  $('#count-duplicates').textContent = formatNumber(result.stats.duplicates);
  document.querySelectorAll('[data-view],[data-library-view],[data-travel-view]').forEach(button => {
    const view = button.dataset.view || button.dataset.libraryView || button.dataset.travelView;
    const active = button.closest('.primary-nav') ? view === 'all' ? libraryView : view === 'footprints' ? ['footprints','journeys'].includes(state.view) : state.view === view : state.view === view;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const months = $('#month-filter'); months.replaceChildren(node('option','','全部月份')); months.firstChild.value = '';
  Object.entries(result.months).forEach(([month,count]) => { const option = node('option','',`${month} · ${formatNumber(count)}`); option.value = month; months.append(option); });
  months.value = state.month;
  const albums = $('#album-filter'), datalist = $('#album-names'); albums.replaceChildren(node('option','','全部相册')); albums.firstChild.value = ''; datalist.replaceChildren();
  Object.entries(result.albums).forEach(([album,count]) => { const option = node('option','',`${album} (${count})`); option.value = album; albums.append(option); const hint = node('option'); hint.value = album; datalist.append(hint); });
  albums.value = state.album;
  $('#availability-filter').value = ['local','preview','unavailable'].includes(state.view) ? state.view : 'all';
  $('#check-duplicates').hidden = state.view !== 'duplicates';
  state.source = result.source; $('#source-name').textContent = '图库设置';
}
function showStatus(status) {
  state.phase = status.phase; state.busy = ['scanning','duplicates'].includes(status.phase);
  const box = $('#status'); box.hidden = !state.busy && status.phase !== 'error' && !(state.view === 'duplicates' && status.duplicates_checked);
  box.className = `status-message${status.phase === 'error' ? ' error' : ''}`;
  box.textContent = status.message || '';
  $('#refresh').disabled = $('#source-button').disabled = state.busy;
  $('#check-duplicates').disabled = state.busy;
  $('#updated').textContent = status.updated_at ? `更新于 ${new Date(status.updated_at).toLocaleDateString('zh-CN')}` : '';
}
function showError(error) { $('#status').hidden = false; $('#status').className = 'status-message error'; $('#status').textContent = error.message; }
async function load(append = false) {
  const generation = ++state.generation;
  const params = new URLSearchParams({ view: state.view, month: state.month, album: state.album, q: state.q, limit: '80', offset: String(append ? state.photos.length : 0), category: state.category, media_type: state.mediaType, mode: state.mode });
  const result = state.view === 'cleanup' ? await window.PhotoCleanup.fetchPage(append) : await api(`/api/photos?${params}`);
  if (generation !== state.generation) return;
  state.photos = append ? [...new Map([...state.photos, ...result.photos].map(photo => [photo.id, photo])).values()] : result.photos; state.count = result.count;
  renderNavigation(result); showStatus(result.status); renderGallery();
  if (state.view === 'journeys' && typeof loadJourneys === 'function') await loadJourneys();
  if (state.view === 'footprints') await window.PhotoFootprints.load();
  if (!['cleanup','footprints','journeys'].includes(state.view)) await window.PhotoOrganizer.refresh();
  if (state.view === 'cleanup') await window.PhotoCleanup.render();
}
function renderPhoto() {
  const photo = state.photos[state.current]; if (!photo) return;
  $('#photo-title').textContent = photo.title || photo.filename; $('#photo-date').textContent = displayDate(photo.date);
  $('#photo-frame').replaceChildren(photoImage(photo, true)); window.PhotoZoom?.reset(); $('#photo-position').textContent = `${state.current + 1} / ${state.photos.length}${state.photos.length < state.count ? '（已载入）' : ''}`;
  $('#previous-photo').disabled = state.current <= 0; $('#next-photo').disabled = state.current >= state.photos.length - 1 && state.photos.length >= state.count;
  $('#photo-availability').textContent = availability[photo.availability];
  const metadata = $('#photo-metadata'); metadata.replaceChildren();
  const fields = { 文件名: photo.filename, 尺寸: photo.width && photo.height ? `${photo.width} × ${photo.height}` : '不详', 日期来源: photo.date_source === 'file' ? '文件修改时间' : '拍摄时间', 拍摄地点: photo.place || (photo.location ? `${photo.location.lat.toFixed(4)}°, ${photo.location.lon.toFixed(4)}°` : '未记录拍摄位置'), 相册: photo.albums.join(', ') || '—', 标签: photo.tags.join(', ') || '—' };
  Object.entries(fields).forEach(([key, value]) => metadata.append(node('dt', '', key), node('dd', '', value)));
  $('#favorite-photo').textContent = photo.favorite ? '★ 已收藏' : '☆ 加入收藏'; $('#favorite-photo').setAttribute('aria-pressed', String(photo.favorite));
  $('#custom-album').value = photo.custom_album; $('#tags').value = photo.custom_tags.join(', '); $('#note').value = photo.note; $('#save-status').textContent = '';
  window.PhotoOrganizer.renderPhoto(photo);
  $('#cleanup-preview-caption').hidden = state.view !== 'cleanup';
  $('#cleanup-preview-caption').textContent = `${photo.content_review?.label || photo.filename} · ${photo.content_review?.short_description || photo.content_review?.description || ''}`;
  $('#download-original').hidden = !photo.has_original; $('#download-original').href = `/api/original/${photo.id}`;
  $('#original-help').textContent = photo.has_original ? '保存的是原图副本，源文件保持原样。' : '原图尚未保存在本机，请先在系统照片中下载，再刷新相册。';
}
function openPhoto(index) { state.current = index; renderPhoto(); $('#photo-dialog').showModal(); }
async function nextPhoto(direction) {
  const target = state.current + direction;
  if (target >= state.photos.length && state.photos.length < state.count) { await load(true); }
  if (target >= 0 && target < state.photos.length) { state.current = target; renderPhoto(); }
}
function openSource() { if (!state.source) return; $('#source-kind').value = state.source.kind; $('#source-path').value = state.source.path; $('#source-error').textContent = ''; $('#source-dialog').showModal(); }
async function refresh(source) { await api('/api/scan', source ? { source } : {}); await load(); }
document.querySelectorAll('[data-view],[data-library-view],[data-travel-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view || button.dataset.libraryView || button.dataset.travelView; state.mode = 'keyword'; load().catch(showError); }));
$('#search').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = event.target.value.trim(); load().catch(showError); }, state.mode === 'semantic' ? 800 : 250); });
$('#album-filter').addEventListener('change', event => { state.album = event.target.value; load().catch(showError); });
$('#month-filter').addEventListener('change', event => { state.month = event.target.value; load().catch(showError); });
$('#availability-filter').addEventListener('change', event => { state.view = event.target.value; load().catch(showError); });
$('#clear-filters').addEventListener('click', () => { state.view = 'all'; state.month = state.album = state.q = state.category = state.mediaType = ''; $('#search').value = ''; load().catch(showError); });
$('#load-more').addEventListener('click', async () => { $('#load-more').disabled = true; try { await load(true); } catch (error) { showError(error); } finally { $('#load-more').disabled = false; } });
$('#refresh').addEventListener('click', () => refresh().catch(showError));
$('#check-duplicates').addEventListener('click', async () => { try { await api('/api/duplicates', {}); await load(); } catch (error) { showError(error); } });
$('#source-button').addEventListener('click', openSource); $('#empty-source').addEventListener('click', openSource); $('#close-source').addEventListener('click', () => $('#source-dialog').close());
$('#source-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.target.querySelector('[type="submit"]'); button.disabled = true; try { await refresh({ kind: $('#source-kind').value, path: $('#source-path').value.trim() }); $('#source-dialog').close(); } catch (error) { $('#source-error').textContent = error.message; } finally { button.disabled = false; } });
$('#close-photo').addEventListener('click', () => $('#photo-dialog').close()); $('#previous-photo').addEventListener('click', () => nextPhoto(-1).catch(showError)); $('#next-photo').addEventListener('click', () => nextPhoto(1).catch(showError));
$('#favorite-photo').addEventListener('click', async () => { const photo = state.photos[state.current]; try { const update = await api(`/api/annotations/${photo.id}`, { favorite: !photo.favorite }); state.photos[state.current] = update; renderPhoto(); renderGallery(); toast(update.favorite ? '已加入收藏' : '已取消收藏'); } catch (error) { toast(error.message); } });
$('#annotation-form').addEventListener('submit', async event => { event.preventDefault(); const photo = state.photos[state.current]; const button = event.target.querySelector('[type="submit"]'); button.disabled = true; try { const update = await api(`/api/annotations/${photo.id}`, { album: $('#custom-album').value.trim(), tags: $('#tags').value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean), note: $('#note').value.trim(), category: $('#photo-category').value, media_type: $('#photo-media-type').value, review: $('#photo-review').value }); state.photos[state.current] = update; renderPhoto(); $('#save-status').textContent = '已保存到本地相册。'; renderGallery(); } catch (error) { $('#save-status').textContent = error.message; } finally { button.disabled = false; } });
$('#photo-dialog').addEventListener('close', () => { state.current = -1; if (state.view === 'footprints') window.PhotoFootprints.closePhoto(); else if (state.view === 'journeys' && typeof closeJourneyPhoto === 'function') closeJourneyPhoto(); else load().catch(showError); });
document.addEventListener('keydown', event => { const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName); if ($('#photo-dialog').open && !editing && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); nextPhoto(event.key === 'ArrowLeft' ? -1 : 1).catch(showError); } else if (event.key === '/' && !editing && !$('#source-dialog').open && !$('#photo-dialog').open) { event.preventDefault(); $('#search').focus(); } });
try { if (localStorage.getItem('local-photo-theme') === 'dark' || (!localStorage.getItem('local-photo-theme') && matchMedia('(prefers-color-scheme: dark)').matches)) document.body.classList.add('dark'); } catch {}
$('#theme').addEventListener('click', () => { document.body.classList.toggle('dark'); try { localStorage.setItem('local-photo-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); } catch {} });
async function poll() { try { if (window.PhotoCleanup?.isBusy()) return; const result = await api('/api/status'); const changed = result.status.phase !== state.phase || result.status.updated_at !== poll.updated || result.review_revision !== poll.reviewRevision; poll.updated = result.status.updated_at; poll.reviewRevision = result.review_revision; state.token = result.token; showStatus(result.status); if (changed && !$('#photo-dialog').open) await load(); } catch (error) { showError(error); } finally { setTimeout(poll, state.busy ? 1800 : 10000); } }
(async () => { try { const status = await api('/api/status'); state.token = status.token; poll.updated = status.status.updated_at; poll.reviewRevision = status.review_revision; await load(); } catch (error) { showError(error); } poll(); })();

window.addEventListener('hashchange', () => { const view = {'#journeys':'journeys', '#cleanup':'cleanup', '#organize':'all', '#footprints':'footprints', '#time-map':'footprints'}[location.hash]; if (view && view !== state.view) { state.view = view; load().catch(showError); } });

(() => {
  let zoom=1;
  function apply(){
    const frame=$('#photo-frame'),wrapper=frame.querySelector('.large-image'),image=frame.querySelector('img');
    $('#photo-zoom-value').textContent=zoom===1?'适应':`${zoom}×`;$('#photo-zoom-out').disabled=zoom<=1;$('#photo-zoom-in').disabled=zoom>=4;
    if(!wrapper||!image)return;
    if(zoom===1){wrapper.removeAttribute('style');image.removeAttribute('style');frame.scrollTop=frame.scrollLeft=0;return;}
    if(!image.naturalWidth||!frame.clientWidth)return;
    const rect=frame.getBoundingClientRect(),fit=Math.min(rect.width/image.naturalWidth,rect.height/image.naturalHeight);
    const width=Math.round(image.naturalWidth*fit*zoom),height=Math.round(image.naturalHeight*fit*zoom);
    const cx=(frame.scrollLeft+frame.clientWidth/2)/Math.max(wrapper.scrollWidth,frame.clientWidth),cy=(frame.scrollTop+frame.clientHeight/2)/Math.max(wrapper.scrollHeight,frame.clientHeight);
    wrapper.style.cssText=`width:${Math.max(width,frame.clientWidth)}px;height:${Math.max(height,frame.clientHeight)}px;display:flex;align-items:center;justify-content:center;`;
    image.style.cssText=`width:${width}px;height:${height}px;max-width:none;max-height:none;flex:none;`;
    frame.scrollLeft=cx*wrapper.scrollWidth-frame.clientWidth/2;frame.scrollTop=cy*wrapper.scrollHeight-frame.clientHeight/2;
  }
  function change(amount){zoom=Math.min(4,Math.max(1,zoom+amount));apply();}
  function reset(){zoom=1;apply();const image=$('#photo-frame img');if(image&&!image.complete)image.addEventListener('load',apply,{once:true});}
  $('#photo-zoom-in').addEventListener('click',()=>change(.5));$('#photo-zoom-out').addEventListener('click',()=>change(-.5));$('#photo-zoom-fit').addEventListener('click',reset);
  $('#photo-frame').addEventListener('dblclick',()=>{zoom=zoom===1?2:1;apply();});
  document.addEventListener('keydown',event=>{if(!$('#photo-dialog').open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if(['+','='].includes(event.key)){event.preventDefault();change(.5);}else if(event.key==='-'){event.preventDefault();change(-.5);}});
  window.PhotoZoom={reset};
})();
