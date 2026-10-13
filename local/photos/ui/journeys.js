'use strict';
const tripState = { lists: null, detail: null, position: 0, visible: 100, land: null, bounds: null, timer: null, generation: 0, returnPhotos: null };
const svgNode = (tag, attributes = {}) => { const element = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value))); return element; };
const mercatorY = latitude => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, latitude)) * Math.PI / 360));
const mercatorX = longitude => longitude * Math.PI / 180;
function stopReplay() { if (tripState.timer) clearInterval(tripState.timer); tripState.timer = null; $('#replay').textContent = '▶ 按时间回看'; }
function routePhotos() { return tripState.detail ? tripState.detail.photos : []; }
function mapCoordinates(photo) { const first = routePhotos().find(value => value.location); const center = first ? first.location.lon : 0; return [mercatorX(center + ((photo.location.lon - center + 180) % 360 - 180)), mercatorY(photo.location.lat)]; }
function fitRoute() {
  const locations = routePhotos().filter(photo => photo.location).map(mapCoordinates);
  if (!locations.length) { tripState.bounds = [-Math.PI, -1.5, Math.PI, 1.5]; return; }
  const xs = locations.map(point => point[0]), ys = locations.map(point => point[1]);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2, centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const spanX = Math.max(.001, Math.max(...xs) - Math.min(...xs)) * 1.4, spanY = Math.max(.001, Math.max(...ys) - Math.min(...ys)) * 1.4;
  const width = Math.max(spanX, spanY * 900 / 520), height = width * 520 / 900;
  tripState.bounds = [centerX - width / 2, centerY - height / 2, centerX + width / 2, centerY + height / 2];
}
function project(x, y) { const [left, bottom, right, top] = tripState.bounds; return [(x - left) / (right - left) * 900, (top - y) / (top - bottom) * 520]; }
function coordinatePath(ring) {
  const first = routePhotos().find(photo => photo.location), center = first ? first.location.lon : 0;
  const points = ring.map(([lon, lat]) => [center + ((lon - center + 180) % 360 - 180), lat]);
  let path = '', previous = null;
  for (const [lon, lat] of points) {
    const [x, y] = project(mercatorX(lon), mercatorY(lat));
    path += (!previous || Math.abs(lon - previous) > 180 ? 'M' : 'L') + `${x.toFixed(2)},${y.toFixed(2)}`;
    previous = lon;
  }
  return path + 'Z';
}
function drawMap() {
  if (!tripState.detail) return;
  if (!tripState.bounds) fitRoute();
  const activePhoto = routePhotos()[tripState.position];
  $('#map-location').textContent = activePhoto ? activePhoto.location ? `${activePhoto.place || '照片 GPS'} · ${activePhoto.location.lat.toFixed(3)}°, ${activePhoto.location.lon.toFixed(3)}° (WGS84)` : '这张照片没有拍摄位置' : '';
  if (window.PhotoAmap?.draw(tripState.position, tripState.detail.journey.id)) return;
  const map = $('#route-map'); map.replaceChildren();
  map.append(svgNode('rect', { x: 0, y: 0, width: 900, height: 520, fill: '#e9efee' }));
  const land = svgNode('g', { fill: '#f7f5ec', stroke: '#d5ded2', 'stroke-width': '.7', 'fill-rule': 'evenodd' });
  if (tripState.land) tripState.land.features.forEach(feature => {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polygons.forEach(polygon => { land.append(svgNode('path', { d: polygon.map(coordinatePath).join('') })); });
  });
  map.append(land);
  const [left, bottom, right, top] = tripState.bounds;
  const step = Math.pow(10, Math.floor(Math.log10((right - left) / 5)));
  const grid = svgNode('g', { stroke: '#647b6720', 'stroke-width': 1 });
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) { const projected = project(x, bottom)[0]; grid.append(svgNode('line', { x1: projected, y1: 0, x2: projected, y2: 520 })); }
  for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) { const projected = project(left, y)[1]; grid.append(svgNode('line', { x1: 0, y1: projected, x2: 900, y2: projected })); }
  map.append(grid);
  const photos = routePhotos();
  const locations = photos.map((photo, index) => photo.location ? { photo, index, point: project(...mapCoordinates(photo)) } : null).filter(Boolean);
  $('#map-empty').hidden = locations.length > 0;
  if (locations.length) {
    const sampled = locations.filter((_, index) => index % Math.max(1, Math.floor(locations.length / 1200)) === 0 || index === locations.length - 1);
    const allPath = sampled.map(({ point }) => point.map(value => value.toFixed(2)).join(',')).join(' ');
    map.append(svgNode('polyline', { points: allPath, fill: 'none', stroke: '#91b49d', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': '4 4' }));
    const followed = sampled.filter(location => location.index <= tripState.position).map(({ point }) => point.map(value => value.toFixed(2)).join(',')).join(' ');
    map.append(svgNode('polyline', { points: followed, fill: 'none', stroke: '#355e43', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    const occupied = new Set();
    sampled.forEach(({ photo, index, point: [x, y] }) => {
      const cell = `${Math.round(x / 12)},${Math.round(y / 12)}`;
      if (occupied.has(cell) && index !== tripState.position) return;
      occupied.add(cell);
      const circle = svgNode('circle', { cx: x, cy: y, r: index === tripState.position ? 8 : 4, fill: index === tripState.position ? '#da9856' : '#52775b', stroke: '#fff', 'stroke-width': 1.5, class: 'map-pin', tabindex: 0, role: 'button', 'aria-label': `Photo from ${displayDate(photo.date)}` });
      const title = svgNode('title'); title.textContent = `${displayDate(photo.date)} · ${photo.place || '拍摄地点'}`; circle.append(title);
      circle.addEventListener('click', () => selectMoment(index)); circle.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectMoment(index); } }); map.append(circle);
    });
    const active = photos[tripState.position];
    if (active && active.location) { const [x, y] = project(...mapCoordinates(active)); map.append(svgNode('circle', { cx: x, cy: y, r: 12, fill: '#d99b6240', stroke: '#b77a42', 'stroke-width': 2, 'pointer-events': 'none' })); }
  }
  const photo = photos[tripState.position];
  $('#map-location').textContent = photo ? photo.location ? `${photo.place || '拍摄地点'} · ${photo.location.lat.toFixed(3)}°, ${photo.location.lon.toFixed(3)}°` : '这张照片没有拍摄位置' : '';
}
function selectMoment(index, scroll = true) {
  const photos = routePhotos(); if (index < 0 || index >= photos.length) return;
  tripState.position = index; $('#journey-scrubber').value = index; $('#replay-position').textContent = `${index + 1} / ${photos.length}`;
  document.querySelectorAll('.timeline-moment').forEach(button => button.classList.toggle('active', Number(button.dataset.index) === index));
  if (index >= tripState.visible) { tripState.visible = index + 30; renderTimeline(); }
  if (scroll) {
    const active = $(`.timeline-moment[data-index="${index}"]`), panel = $('.journey-timeline');
    if (active && panel) {
      const row = active.getBoundingClientRect(), visible = panel.getBoundingClientRect();
      if (row.top < visible.top) panel.scrollTop -= visible.top - row.top;
      else if (row.bottom > visible.bottom) panel.scrollTop += row.bottom - visible.bottom;
    }
  }
  drawMap();
}
function renderTimeline() {
  const list = $('#timeline-list'); list.replaceChildren();
  routePhotos().slice(0, tripState.visible).forEach((photo, index) => {
    const card = node('article', 'timeline-card');
    const button = node('button', `timeline-moment${index === tripState.position ? ' active' : ''}`); button.dataset.index = index;
    const image = photo.has_preview ? photoImage(photo) : placeholder('本机没有预览');
    const text = node('div', 'timeline-text'); text.append(node('time', '', displayDate(photo.date)), node('strong', '', photo.title || photo.filename), node('span', '', photo.place || (photo.location ? '已记录拍摄位置' : '未记录拍摄位置')));
    button.append(image, text); button.addEventListener('click', () => { stopReplay(); selectMoment(index, false); });
    const open = node('button', 'timeline-open', '↗'); open.setAttribute('aria-label', `查看旅行照片 ${index + 1}`); open.addEventListener('click', () => openJourneyPhoto(index));
    card.append(button, open); list.append(card);
  });
  $('#timeline-more').hidden = tripState.visible >= routePhotos().length;
}
function openJourneyPhoto(index) { stopReplay(); tripState.returnPhotos = state.photos; state.photos = [...routePhotos()]; state.count = state.photos.length; openPhoto(index); }
function closeJourneyPhoto() { if (tripState.returnPhotos) state.photos = tripState.returnPhotos; tripState.returnPhotos = null; load().catch(showError); }
async function openJourney(id) {
  stopReplay(); const generation = ++tripState.generation;
  const result = await api(`/api/journeys/${encodeURIComponent(id)}`);
  if (generation !== tripState.generation) return;
  tripState.detail = result; tripState.position = 0; tripState.visible = 100; fitRoute();
  $('#journey-detail').hidden = false; $('#journey-title').textContent = result.journey.title;
  $('#journey-summary').textContent = `${displayDate(result.journey.start)} — ${displayDate(result.journey.end)} · ${formatNumber(result.photos.length)} 张照片 · ${formatNumber(result.located)} 张有拍摄位置 · ${formatNumber(result.missing_locations)} 张无位置信息`;
  $('#save-suggestion').hidden = !result.journey.suggested;
  $('#journey-scrubber').max = Math.max(0, result.photos.length - 1);
  document.querySelectorAll('.journey-card').forEach(card => card.classList.toggle('active', card.dataset.id === id));
  renderTimeline(); selectMoment(0, false);
  await window.PhotoAmap?.prepare(result);
  if (generation !== tripState.generation) return;
  selectMoment(tripState.position, false);
  if (!tripState.land) { try { const response = await fetch('/local-photos/land.geojson'); if (!response.ok) throw new Error('离线底图暂不可用'); tripState.land = await response.json(); drawMap(); } catch (error) { toast(error.message); } }
}
async function loadJourneys() {
  const result = await api('/api/journeys'); tripState.lists = result;
  $('#geo-coverage').textContent = `${formatNumber(result.total)} 张照片中，${formatNumber(result.located)} 张记录了拍摄位置。地点信息从本机图库读取。`;
  const list = $('#journey-list'); list.replaceChildren();
  const entries = [...result.saved, ...result.suggestions];
  entries.forEach(entry => {
    const button = node('button', `journey-card${tripState.detail && tripState.detail.journey.id === entry.id ? ' active' : ''}`); button.dataset.id = entry.id;
    if (entry.cover) { const cover = node('img'); cover.src = `/api/preview/${entry.cover}`; cover.alt = ''; cover.loading = 'lazy'; cover.addEventListener('error', () => { cover.hidden = true; }, { once: true }); button.append(cover); }
    const text = node('div', 'journey-card-text'); text.append(node('span', 'journey-type', entry.suggested ? '建议相册' : '旅行相册'), node('strong', '', entry.title), node('span', '', `${displayDate(entry.start)} · ${entry.count} 张照片`)); button.append(text);
    button.addEventListener('click', () => openJourney(entry.id).catch(showError)); list.append(button);
  });
  if (!entries.length) list.append(node('p', 'muted', '选择日期范围创建旅行相册，没有 GPS 的照片仍可按时间查看。'));
  if (!tripState.detail && entries.length) await openJourney(entries[0].id);
  if (tripState.detail && !entries.some(entry => entry.id === tripState.detail.journey.id)) { tripState.detail = null; $('#journey-detail').hidden = true; }
}
function journeyForm(suggestion = null) {
  $('#journey-city').value = suggestion?.city_id || '';
  $('#journey-city-scope').hidden = !suggestion?.city_id;
  $('#journey-city-scope').textContent = suggestion?.city_id ? '仅整理当前城市的照片，其他城市的照片不会加入。' : '';
  $('#journey-name').value = suggestion ? suggestion.title : '';
  $('#journey-start').value = suggestion ? suggestion.start : '';
  $('#journey-end').value = suggestion ? suggestion.end : '';
  $('#journey-intro').value = suggestion ? suggestion.intro : '';
  $('#journey-error').textContent = '';
  const select = $('#journey-album'); select.replaceChildren(node('option', '', '该日期范围内的全部照片')); select.firstChild.value = '';
  Array.from($('#album-filter').options).filter(option => option.value).forEach(option => { const item = node('option', '', option.textContent); item.value = option.value; select.append(item); });
  $('#journey-dialog').showModal();
}
$('#new-journey').addEventListener('click', () => journeyForm());
$('#save-suggestion').addEventListener('click', () => journeyForm(tripState.detail.journey));
$('#close-journey').addEventListener('click', () => $('#journey-dialog').close());
$('#journey-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
  try { const entry = await api('/api/journeys', { title: $('#journey-name').value.trim(), start: $('#journey-start').value, end: $('#journey-end').value, album: $('#journey-album').value, intro: $('#journey-intro').value.trim(), city_id: $('#journey-city').value }); $('#journey-dialog').close(); state.view = 'journeys'; await load(); await openJourney(entry.id); toast('旅行相册已保存到本机'); }
  catch (error) { $('#journey-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#timeline-more').addEventListener('click', () => { tripState.visible += 100; renderTimeline(); });
$('#journey-scrubber').addEventListener('input', event => { stopReplay(); selectMoment(Number(event.target.value)); });
$('#replay').addEventListener('click', () => {
  if (tripState.timer) { stopReplay(); return; }
  if (!routePhotos().length) return;
  if (tripState.position >= routePhotos().length - 1) selectMoment(0);
  $('#replay').textContent = 'Ⅱ 暂停';
  tripState.timer = setInterval(() => { if (state.view !== 'journeys' || tripState.position >= routePhotos().length - 1) stopReplay(); else selectMoment(tripState.position + 1); }, 1000);
});
$('#map-fit').addEventListener('click', () => { if (window.PhotoAmap?.fit()) return; fitRoute(); drawMap(); });
function zoomMap(factor) { if (!tripState.bounds) return; const [left, bottom, right, top] = tripState.bounds; const x = (left + right) / 2, y = (top + bottom) / 2; const width = (right - left) * factor / 2, height = (top - bottom) * factor / 2; if (width < 0.00001 || width > 8) return; tripState.bounds = [x - width, y - height, x + width, y + height]; drawMap(); }
$('#map-in').addEventListener('click', () => { if (!window.PhotoAmap?.zoom(1)) zoomMap(.7); }); $('#map-out').addEventListener('click', () => { if (!window.PhotoAmap?.zoom(-1)) zoomMap(1.4); });
let drag = null;
$('#route-map').addEventListener('pointerdown', event => { if (event.target.closest('.map-pin')) return; drag = { x: event.clientX, y: event.clientY, bounds: [...tripState.bounds] }; event.currentTarget.setPointerCapture(event.pointerId); });
$('#route-map').addEventListener('pointermove', event => { if (!drag) return; const rectangle = event.currentTarget.getBoundingClientRect(); const [left, bottom, right, top] = drag.bounds; const x = (event.clientX - drag.x) / rectangle.width * (right - left), y = (event.clientY - drag.y) / rectangle.height * (top - bottom); tripState.bounds = [left - x, bottom + y, right - x, top + y]; drawMap(); });
$('#route-map').addEventListener('pointerup', () => { drag = null; }); $('#route-map').addEventListener('pointercancel', () => { drag = null; });
$('#share-story').addEventListener('click', () => { stopReplay(); $('#story-locations').checked = $('#story-notes').checked = false; $('#story-error').textContent = ''; $('#story-dialog').showModal(); });
$('#close-story').addEventListener('click', () => $('#story-dialog').close());
$('#story-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('[type="submit"]'); button.disabled = true; button.textContent = '正在准备本地预览…';
  try {
    const response = await fetch('/api/story', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Photo-Token': state.token }, body: JSON.stringify({ id: tripState.detail.journey.id, limit: Number($('#story-limit').value), include_locations: $('#story-locations').checked, include_notes: $('#story-notes').checked }) });
    if (!response.ok) { const result = await response.json(); throw new Error(result.error || '无法导出这个故事，请重试。'); }
    const blob = await response.blob(), url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = 'photo-journey.html'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('#story-dialog').close(); toast('离线故事已导出，尚未发布。');
  } catch (error) { $('#story-error').textContent = error.message; } finally { button.disabled = false; button.textContent = '导出 HTML 故事'; }
});
