'use strict';
const $ = selector => document.querySelector(selector);
const state = { view: location.hash === '#organize' ? 'organize' : ['#time-map', '#footprints'].includes(location.hash) ? 'footprints' : 'all', month: '', album: '', q: '', category: '', mediaType: '', review: '', mode: 'keyword', unprocessed: false, photos: [], count: 0, token: '', source: null, phase: '', current: -1, generation: 0, busy: false };
const titles = { all: '全部照片', favorites: '收藏', duplicates: '完全重复', journeys: '旅行相册', local: 'On this Mac', preview: '本地预览', unavailable: '尚未下载' };
const descriptions = { all: '把值得留下的瞬间，整理在这里。', favorites: '那些想再看一遍的瞬间。', duplicates: '按文件内容检查本地原图，仅做分组，不删除照片。云端原图未参与比较。', journeys: '按旅行整理照片，重温当时的地点与回忆。', local: '这些照片的原图已经保存在本机。', preview: '可以查看本机预览，原图仍在 iCloud 中，需要时可先在系统照片中下载。', unavailable: '这些项目在本机没有原图或预览，请先在系统照片中下载，再刷新相册。' };
const availability = { local: '原图在本机', preview: '仅有本地预览', unavailable: '尚未下载' };
titles.footprints = '旅游足迹';
descriptions.footprints = '照片拍在哪里，就点亮哪里。看看这些年，你留下了哪些回忆。';
titles.organize = '内容整理'; descriptions.organize = '按类型、内容和标签找回照片，把清理决定留给自己。';
const formatNumber = value => Number(value || 0).toLocaleString('zh-CN');
const node = (tag, className, text) => { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result; };
const displayDate = value => { if (!value) return '日期不明'; const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }); };
const monthName = value => value === '不详' ? value : new Date(`${value}-01T12:00:00`).toLocaleDateString('zh-CN', { month: 'long' });
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
  if (['journeys', 'footprints'].includes(state.view)) { $('#gallery').hidden = $('#empty').hidden = true; $('#load-more').hidden = true; return; }
  $('#gallery').hidden = false;
  const gallery = $('#gallery'); gallery.replaceChildren(); let group = '', groupNumber = 0;
  state.photos.forEach((photo, index) => {
    if (state.view === 'duplicates' && photo.duplicate !== group) { group = photo.duplicate; groupNumber += 1; const heading = node('div', 'duplicate-heading', `第 ${groupNumber} 组重复照片`); heading.append(node('span', '', '文件内容完全相同')); gallery.append(heading); }
    const element = card(photo, index);
    if (state.view === 'organize') window.PhotoOrganizer.decorate(element, photo);
    gallery.append(element);
  });
  const count = state.count;
  $('#results-count').textContent = `${formatNumber(count)} 张照片${state.photos.length < count ? ` · 已显示 ${state.photos.length} 张` : ''}`;
  $('#load-more').hidden = state.photos.length >= count;
  $('#empty').hidden = count > 0;
  const hasFilters = state.view !== 'all' || state.month || state.album || state.q;
  $('#clear-filters').hidden = !hasFilters;
  $('#empty-source').hidden = Boolean(hasFilters) || state.busy;
  if (!count) {
    const error = state.phase === 'error';
    $('#empty-title').textContent = state.busy ? '正在整理照片…' : error ? '图库暂时无法读取' : hasFilters ? '没有符合条件的照片' : '开始整理你的照片';
    $('#empty-description').textContent = state.busy ? '正在读取本机照片信息，整理完成后会显示照片。' : error ? '请查看上方提示，或选择已导出的本地照片文件夹。' : hasFilters ? '可以换一个相册、月份或搜索词，原图仍保留在原位置。' : '连接照片图库或本地文件夹，照片文件保留在本机。';
  }
}
function renderNavigation(result) {
  const journeyView = state.view === 'journeys';
  $('#journey-workbench').hidden = !journeyView;
  document.querySelectorAll('.photo-only').forEach(element => { element.hidden = journeyView; });
  document.body.classList.toggle('journey-view', journeyView);
  const footprintView = state.view === 'footprints';
  $('#footprint-workbench').hidden = !footprintView;
  document.body.classList.toggle('footprint-view', footprintView);
  if (footprintView) document.querySelectorAll('.photo-only').forEach(element => { element.hidden = true; });
  if (!journeyView) window.PhotoAmap?.deactivate();
  if (!footprintView) window.PhotoFootprints?.deactivate();
  $('#organize-workbench').hidden = state.view !== 'organize';
  document.body.classList.toggle('organize-view', state.view === 'organize');
  $('#count-all').textContent = formatNumber(result.stats.total); $('#count-favorites').textContent = formatNumber(result.stats.favorites); $('#count-duplicates').textContent = formatNumber(result.stats.duplicates);
  ['local', 'preview', 'unavailable'].forEach(key => { $(`#stat-${key}`).textContent = formatNumber(result.stats[key]); });
  $('#view-title').textContent = titles[state.view];
  $('#view-description').textContent = descriptions[state.view];
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === state.view); });
  document.querySelectorAll('[data-availability]').forEach(button => { button.classList.toggle('active', button.dataset.availability === state.view); });
  $('#clear-month').hidden = !state.month;
  const months = $('#months'); months.replaceChildren(); let year = '';
  Object.entries(result.months).forEach(([month, count]) => {
    if (month.slice(0, 4) !== year) { year = month.slice(0, 4); months.append(node('div', 'year-label', year)); }
    const button = node('button', `month-button${state.month === month ? ' active' : ''}`); button.append(node('span', '', monthName(month)), node('span', '', formatNumber(count)));
    button.addEventListener('click', () => { state.month = state.month === month ? '' : month; load().catch(showError); }); months.append(button);
  });
  const albums = $('#album-filter'), datalist = $('#album-names'); albums.replaceChildren(node('option', '', '全部相册')); albums.firstChild.value = ''; datalist.replaceChildren();
  Object.entries(result.albums).forEach(([album, count]) => { const option = node('option', '', `${album} (${count})`); option.value = album; albums.append(option); const suggestion = node('option'); suggestion.value = album; datalist.append(suggestion); });
  albums.value = state.album;
  state.source = result.source; $('#source-name').textContent = state.source.kind === 'photos' ? '系统照片图库' : '本地文件夹';
}
function showStatus(status) {
  state.phase = status.phase; state.busy = ['scanning', 'duplicates'].includes(status.phase);
  const box = $('#status'); box.className = `status-message${status.phase === 'error' ? ' error' : state.busy ? ' busy' : ' quiet'}`;
  box.textContent = status.message + (state.busy && status.processed ? ` 已处理 ${formatNumber(status.processed)} 项。` : '');
  $('#refresh').disabled = state.busy; $('#check-duplicates').disabled = state.busy || !state.photos.length; $('#source-button').disabled = state.busy;
  $('#updated').textContent = status.updated_at ? `更新于 ${new Date(status.updated_at).toLocaleString('zh-CN')}` : '本地相册';
}
function showError(error) { $('#status').className = 'status-message error'; $('#status').textContent = error.message; }
async function load(append = false) {
  const generation = ++state.generation;
  const params = new URLSearchParams({ view: state.view, month: state.month, album: state.album, q: state.q, limit: '80', offset: String(append ? state.photos.length : 0), ...(state.view === 'organize' ? { category: state.category, media_type: state.mediaType, review: state.review, mode: state.mode, unprocessed: state.unprocessed ? '1' : '' } : {}) });
  const result = await api(`/api/photos?${params}`);
  if (generation !== state.generation) return;
  state.photos = append ? [...state.photos, ...result.photos] : result.photos; state.count = result.count;
  renderNavigation(result); showStatus(result.status); renderGallery();
  if (state.view === 'journeys' && typeof loadJourneys === 'function') await loadJourneys();
  if (state.view === 'footprints') await window.PhotoFootprints.load();
  if (state.view === 'organize') await window.PhotoOrganizer.refresh();
}
function renderPhoto() {
  const photo = state.photos[state.current]; if (!photo) return;
  $('#photo-title').textContent = photo.title || photo.filename; $('#photo-date').textContent = displayDate(photo.date);
  $('#photo-frame').replaceChildren(photoImage(photo, true)); $('#photo-position').textContent = `${state.current + 1} / ${state.photos.length}${state.photos.length < state.count ? '（已载入）' : ''}`;
  $('#previous-photo').disabled = state.current <= 0; $('#next-photo').disabled = state.current >= state.photos.length - 1 && state.photos.length >= state.count;
  $('#photo-availability').textContent = availability[photo.availability];
  const metadata = $('#photo-metadata'); metadata.replaceChildren();
  const fields = { 文件名: photo.filename, 尺寸: photo.width && photo.height ? `${photo.width} × ${photo.height}` : '不详', 日期来源: photo.date_source === 'file' ? '文件修改时间' : '拍摄时间', 拍摄地点: photo.place || (photo.location ? `${photo.location.lat.toFixed(4)}°, ${photo.location.lon.toFixed(4)}°` : '未记录拍摄位置'), 相册: photo.albums.join(', ') || '—', 标签: photo.tags.join(', ') || '—' };
  Object.entries(fields).forEach(([key, value]) => metadata.append(node('dt', '', key), node('dd', '', value)));
  $('#favorite-photo').textContent = photo.favorite ? '★ 已收藏' : '☆ 加入收藏'; $('#favorite-photo').setAttribute('aria-pressed', String(photo.favorite));
  $('#custom-album').value = photo.custom_album; $('#tags').value = photo.custom_tags.join(', '); $('#note').value = photo.note; $('#save-status').textContent = '';
  window.PhotoOrganizer.renderPhoto(photo);
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
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { state.view = button.dataset.view; state.mode = 'keyword'; load().catch(showError); }));
document.querySelectorAll('[data-availability]').forEach(button => button.addEventListener('click', () => { state.view = state.view === button.dataset.availability ? 'all' : button.dataset.availability; load().catch(showError); }));
$('#search').addEventListener('input', event => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.q = event.target.value.trim(); load().catch(showError); }, state.mode === 'semantic' ? 800 : 250); });
$('#album-filter').addEventListener('change', event => { state.album = event.target.value; load().catch(showError); });
$('#clear-month').addEventListener('click', () => { state.month = ''; load().catch(showError); });
$('#clear-filters').addEventListener('click', () => { state.view = 'all'; state.month = state.album = state.q = ''; $('#search').value = ''; load().catch(showError); });
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
async function poll() { try { const result = await api('/api/status'); const changed = result.status.phase !== state.phase || result.status.updated_at !== poll.updated; poll.updated = result.status.updated_at; state.token = result.token; showStatus(result.status); if (changed && !$('#photo-dialog').open) await load(); } catch (error) { showError(error); } finally { setTimeout(poll, state.busy ? 1800 : 10000); } }
(async () => { try { const status = await api('/api/status'); state.token = status.token; poll.updated = status.status.updated_at; await load(); } catch (error) { showError(error); } poll(); })();
