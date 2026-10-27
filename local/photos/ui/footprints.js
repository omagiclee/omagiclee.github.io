/* Cities are identified from local Photos metadata; AMap supplies public boundaries. */
(() => {
  const s = { result: null, cities: [], selected: null, detail: null, query: '', year: '', country: '', provider: 'amap', map: null, sdk: null, graphics: [], boundaries: new Map(), shapes: new Map(), boundaryDone: new Set(), land: null, generation: 0, dataGeneration: 0, cityGeneration: 0, mapPromise: null, returnPhotos: null };
  const configPromise = api('/api/map-config').catch(() => ({ enabled: false }));
  let nextQueryAt = 0;
  async function querySlot() {
    const at = Math.max(Date.now(), nextQueryAt); nextQueryAt = at + 350;
    if (at > Date.now()) await new Promise(resolve => setTimeout(resolve, at - Date.now()));
  }
  const label = city => [city.province, city.country].filter(value => value && value !== city.name).join(' · ');
  const countryKey = city => city.country_code || city.country || 'unknown';
  const filtered = () => (s.result?.cities || []).filter(city => (!s.country || countryKey(city) === s.country) && (!s.query || `${city.name} ${city.province} ${city.country}`.toLocaleLowerCase().includes(s.query.toLocaleLowerCase())));
  function mapStatus(message) { $('#footprint-map-status').textContent = message; }
  function setMode() { $('#footprint-amap').hidden = s.provider !== 'amap' || !s.map; $('#footprint-offline').toggleAttribute('hidden', s.provider === 'amap' && Boolean(s.map)); }
  function deactivate() { ++s.generation; if (s.map) s.map.destroy(); s.map = null; s.graphics = []; }
  async function load() {
    const request = ++s.dataGeneration;
    const result = await api(`/api/footprints?year=${encodeURIComponent(s.year)}`);
    if (request !== s.dataGeneration || state.view !== 'footprints') return;
    s.result = result;
    $('#footprint-city-count').textContent = formatNumber(result.stats.cities);
    $('#footprint-country-count').textContent = formatNumber(result.stats.countries);
    $('#footprint-photo-count').textContent = formatNumber(result.stats.photos);
    const years = $('#footprint-year'); years.replaceChildren(node('option', '', '全部年份')); years.firstChild.value = '';
    result.years.forEach(year => { const option = node('option', '', `${year} 年`); option.value = year; years.append(option); }); years.value = s.year;
    const countries = new Map(result.cities.map(city => [countryKey(city), city.country || city.country_code || '国家不详']));
    const select = $('#footprint-country'); select.replaceChildren(node('option', '', '全部国家与地区')); select.firstChild.value = '';
    countries.forEach((name, key) => { const option = node('option', '', name); option.value = key; select.append(option); });
    if (s.country && !countries.has(s.country)) s.country = ''; select.value = s.country;
    $('#footprint-data-note').textContent = `照片地点来自本机图库；其中 ${formatNumber(result.stats.without_gps)} 张没有 GPS，${formatNumber(result.stats.unknown_city)} 张有 GPS 但没有明确城市，未计入足迹。生活城市也会点亮，不代表每次拍摄都是旅行。`;
    $('#footprint-source').hidden = result.stats.cities > 0;
    await render();
  }
  function renderList() {
    const list = $('#footprint-city-list'); list.replaceChildren();
    $('#footprint-list-count').textContent = `${s.cities.length} 座城市`;
    $('#footprint-list-empty').hidden = s.cities.length > 0;
    s.cities.forEach(city => {
      const button = node('button', `footprint-city${s.selected?.id === city.id ? ' active' : ''}`); button.dataset.city = city.id;
      if (city.cover) { const image = node('img'); image.src = `/api/preview/${city.cover}`; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => { image.hidden = true; }, { once: true }); button.append(image); }
      const text = node('span', 'footprint-city-text'); text.append(node('strong', '', city.name), node('span', '', `${formatNumber(city.photo_count)} 张照片 · ${city.days} 个拍摄日`), node('small', '', label(city)));
      text.append(node('small', 'footprint-boundary-note', s.boundaryDone.has(city.id) ? s.shapes.has(city.id) ? '城市区域已点亮' : '暂无城市边界，仅在列表保留' : ''));
      button.append(text, node('span', 'footprint-city-arrow', '↗')); button.addEventListener('click', () => selectCity(city.id).catch(showError)); list.append(button);
    });
  }
  async function render() {
    s.cities = filtered();
    if (s.selected && !s.cities.some(city => city.id === s.selected.id)) { s.selected = null; s.detail = null; $('#footprint-detail').hidden = true; }
    renderList();
    const mapWork = renderMap();
    if (s.selected) await selectCity(s.selected.id, false);
    await mapWork;
  }
  function point(city) { return window.coordtransform.wgs84togcj02(city.center.lon, city.center.lat); }
  async function createMap(config) {
    s.sdk = await window.TravelMapPlatform.loadAmap(config.key, config.securityCode);
    $('#footprint-amap').hidden = false;
    const map = new s.sdk.Map('footprint-amap', { center: [105, 35], zoom: 4, viewMode: '2D', resizeEnable: true, showOversea: true, mapStyle: 'amap://styles/whitesmoke' });
    try { await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('城市地图加载超时')), 12000); map.on('complete', () => { clearTimeout(timer); resolve(); }); }); }
    catch (error) { map.destroy(); throw error; }
    s.map = map;
  }
  function paintGraphics() {
    const maximum = Math.max(1, ...s.cities.map(city => city.photo_count));
    s.graphics.forEach(graphic => {
      const active = graphic.city.id === s.selected?.id;
      if (graphic.polygon) graphic.polygon.setOptions({ fillColor: active ? '#d99b62' : '#679b79', fillOpacity: active ? .6 : .23 + .35 * Math.log1p(graphic.city.photo_count) / Math.log1p(maximum), strokeColor: active ? '#ae713c' : '#437352', strokeWeight: active ? 2.5 : 1, strokeOpacity: .9 });
    });
  }
  function fitMap() {
    if (s.provider === 'amap' && s.map) {
      if (s.graphics.length) s.map.setFitView(s.graphics.map(graphic => graphic.polygon), true, [45, 45, 45, 45], 10);
      else s.map.setZoomAndCenter(4, [105, 35]);
    } else drawOffline();
  }
  function boundary(city) {
    if (s.boundaries.has(city.id)) return s.boundaries.get(city.id);
    const chinese = city.country_code === 'CN' || ['中国', '中华人民共和国'].includes(city.country);
    if (!chinese) return Promise.resolve(null);
    const promise = (async () => {
      await querySlot();
      return new Promise(resolve => {
      const search = new s.sdk.DistrictSearch({ level: 'city', subdistrict: 0, extensions: 'all' });
      const timer = setTimeout(() => resolve(null), 6000);
      search.search(city.name, (status, result) => {
        clearTimeout(timer);
        const normalize = name => String(name || '').replace(/\s|市$/g, '');
        const candidate = status === 'complete' ? result?.districtList?.find(value => normalize(value.name) === normalize(city.name)) : null;
        resolve(candidate?.boundaries?.length ? candidate : null);
      });
      });
    })();
    s.boundaries.set(city.id, promise);
    promise.then(value => { if (value) { s.shapes.set(city.id, value); void window.PhotoBoundaryCache.put(city.id, value); } else s.boundaries.delete(city.id); });
    return promise;
  }
  async function renderMap() {
    const request = ++s.generation;
    const cities = [...s.cities];
    const cacheWork = window.PhotoBoundaryCache.getMany(cities.map(city => city.id));
    const config = await configPromise;
    const cachedShapes = await cacheWork;
    if (request !== s.generation) return;
    cachedShapes.forEach((value, id) => { s.shapes.set(id, value); s.boundaries.set(id, Promise.resolve(value)); s.boundaryDone.add(id); });
    $('#footprint-provider').querySelector('[value="amap"]').disabled = !config.enabled;
    if (!config.enabled) s.provider = 'offline'; $('#footprint-provider').value = s.provider;
    if (s.provider === 'offline' || !s.cities.length) { if (!s.cities.length && s.map) { s.map.remove(s.graphics.map(graphic => graphic.polygon)); s.graphics = []; } setMode(); await drawOffline(); mapStatus(s.cities.length ? '离线模式只绘制当前已缓存的城市边界，不使用定位圆点；其他城市可从列表查看照片。' : '尚未找到明确的拍摄城市。可以连接系统照片图库，或刷新已有相册。'); return; }
    try {
      mapStatus('正在加载高德地图，点亮拍过照片的城市…');
      if (!s.map) { if (!s.mapPromise) s.mapPromise = createMap(config).finally(() => { s.mapPromise = null; }); await s.mapPromise; }
      if (request !== s.generation || state.view !== 'footprints') { if ((state.view !== 'footprints' || s.provider !== 'amap') && s.map) { s.map.destroy(); s.map = null; setMode(); } return; }
      setMode();
      const map = s.map;
      if (s.graphics.length) map.remove(s.graphics.map(graphic => graphic.polygon)); s.graphics = [];
      fitMap(); paintGraphics();
      let cursor = 0, complete = 0, regions = 0;
      const cachePolygons = [];
      const addRegion = (city, result, batch = false) => {
        result.boundaries.forEach(path => {
          const polygon = new s.sdk.Polygon({ path, fillColor: '#679b79', fillOpacity: .35, strokeColor: '#437352', strokeWeight: 1, zIndex: 20 });
          polygon.on('click', () => selectCity(city.id).catch(showError));
          if (batch) cachePolygons.push(polygon); else map.add(polygon);
          s.graphics.push({ city, polygon });
        });
        regions += 1;
      };
      const pending = [];
      cities.forEach(city => {
        const cached = s.shapes.get(city.id);
        if (cached) { addRegion(city, cached, true); s.boundaryDone.add(city.id); complete += 1; }
        else pending.push(city);
      });
      if (cachePolygons.length) { map.add(cachePolygons); paintGraphics(); fitMap(); }
      const restored = regions;
      const updateStatus = () => mapStatus(`已点亮 ${regions} 处行政区域（共 ${cities.length} 座拍摄城市）${complete < cities.length ? `，并行补充边界 ${complete}/${cities.length}…` : '。地图只显示填色区域，不添加定位圆点。'}${restored ? ` 已复用 ${restored} 处本地缓存。` : ''}`);
      updateStatus();
      cities.forEach(city => { const note = $(`.footprint-city[data-city="${city.id}"] .footprint-boundary-note`); if (note && s.shapes.has(city.id)) note.textContent = '城市区域已点亮'; });
      const worker = async () => {
        while (cursor < pending.length && request === s.generation && state.view === 'footprints') {
          const city = pending[cursor++], result = await boundary(city);
          if (request !== s.generation || s.map !== map) return;
          s.boundaryDone.add(city.id);
          if (result) {
            addRegion(city, result); paintGraphics();
          }
          complete += 1;
          const note = $(`.footprint-city[data-city="${city.id}"] .footprint-boundary-note`);
          if (note) note.textContent = result ? '城市区域已点亮' : '暂无城市边界，仅在列表保留';
          updateStatus();
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
      if (request === s.generation && !s.selected) fitMap();
    } catch (_) {
      if (request !== s.generation) return;
      s.provider = 'offline'; if (s.map) s.map.destroy(); s.map = null; s.graphics = []; $('#footprint-provider').value = 'offline'; setMode(); await drawOffline(); mapStatus('高德地图暂不可用，离线模式只显示已缓存的城市区域。照片仍可从列表浏览。');
    }
  }
  async function drawOffline() {
    const canvas = $('#footprint-offline'); canvas.replaceChildren();
    if (!s.land) { try { const response = await fetch('/local-photos/land.geojson'); s.land = await response.json(); } catch {} }
    const cities = s.cities, clamp = lat => Math.max(-85, Math.min(85, lat));
    const y = lat => Math.log(Math.tan(Math.PI / 4 + clamp(lat) * Math.PI / 360));
    const anchor = cities[0]?.center.lon || 0;
    const x = lon => anchor + ((lon - anchor + 180) % 360 - 180);
    const xs = cities.map(city => x(city.center.lon)), ys = cities.map(city => y(city.center.lat));
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cy = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    const width = xs.length ? Math.max(12, Math.max(...xs) - Math.min(...xs)) * 1.35 : 360;
    const height = ys.length ? Math.max(.18, Math.max(...ys) - Math.min(...ys)) * 1.35 : 5;
    const scale = Math.min(800 / width, 440 / height);
    const project = (lon, lat) => [450 + (x(lon) - cx) * scale, 260 - (y(lat) - cy) * scale];
    const svg = (tag, attributes = {}) => { const value = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attributes).forEach(([key, item]) => value.setAttribute(key, item)); return value; };
    canvas.append(svg('rect', { width: 900, height: 520, fill: '#e9efee' }));
    s.land?.features.forEach(feature => {
      const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      polygons.forEach(polygon => {
        const d = polygon.map(ring => ring.map((point, index) => `${index ? 'L' : 'M'}${project(...point).map(value => value.toFixed(2)).join(',')}`).join('') + 'Z').join('');
        canvas.append(svg('path', { d, fill: '#f7f5ec', stroke: '#cbd7c7', 'stroke-width': '.8', 'fill-rule': 'evenodd' }));
      });
    });
    cities.forEach(city => {
      const region = s.shapes.get(city.id); if (!region) return;
      const active = s.selected?.id === city.id;
      const group = svg('g', { role: 'button', tabindex: '0', class: 'footprint-offline-city', 'data-city': city.id, 'aria-label': `查看${city.name}的照片` });
      region.boundaries.forEach(ring => {
        const d = ring.map((coordinate, index) => {
          const lon = typeof coordinate.getLng === 'function' ? coordinate.getLng() : coordinate[0];
          const lat = typeof coordinate.getLat === 'function' ? coordinate.getLat() : coordinate[1];
          const point = window.coordtransform.gcj02towgs84(lon, lat);
          return `${index ? 'L' : 'M'}${project(...point).map(value => value.toFixed(2)).join(',')}`;
        }).join('') + 'Z';
        group.append(svg('path', { d, fill: active ? '#d99b62' : '#659475', 'fill-opacity': '.55', stroke: active ? '#ae713c' : '#437352', 'stroke-width': 1.5 }));
      });
      group.addEventListener('click', () => selectCity(city.id).catch(showError)); group.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectCity(city.id).catch(showError); } }); canvas.append(group);
    });
  }
  async function selectCity(id, focus = true, append = false) {
    const city = s.cities.find(item => item.id === id); if (!city) return;
    const request = ++s.cityGeneration;
    const result = await api(`/api/footprints/${id}?year=${encodeURIComponent(s.year)}&offset=${append ? s.detail?.photos.length || 0 : 0}&limit=60`);
    if (request !== s.cityGeneration || state.view !== 'footprints') return;
    const previous = append && s.selected?.id === id ? s.detail.photos : [];
    s.selected = city; s.detail = { ...result, photos: [...previous, ...result.photos] }; renderList(); paintGraphics();
    if (s.provider === 'offline') await drawOffline();
    if (focus && s.map) {
      const regions = s.graphics.filter(graphic => graphic.city.id === id && graphic.polygon).map(graphic => graphic.polygon);
      if (regions.length) s.map.setFitView(regions, true, [35, 35, 35, 35], 12);
      else s.map.setZoomAndCenter(9, point(city));
    }
    $('#footprint-detail').hidden = false;
    $('#footprint-city-title').textContent = city.name;
    $('#footprint-city-description').textContent = `${label(city)}${label(city) ? ' · ' : ''}${formatNumber(city.photo_count)} 张照片，记录了 ${city.days} 个拍摄日。${city.first_date ? `最早 ${displayDate(city.first_date)}，最近 ${displayDate(city.last_date)}。` : ''}`;
    $('#footprint-city-dates').textContent = `最近的拍摄日期：${Object.entries(result.days).slice(0, 6).map(([day, count]) => `${displayDate(day)}（${count} 张）`).join('、')}`;
    const gallery = $('#footprint-photo-grid'); gallery.replaceChildren();
    s.detail.photos.forEach((photo, index) => { const element = card(photo, index); element.querySelector('.photo-open').replaceWith(cityPhotoButton(photo, index)); gallery.append(element); });
    $('#footprint-load-more').hidden = s.detail.photos.length >= result.count;
  }
  function cityPhotoButton(photo, index) {
    const button = node('button', 'photo-open'); button.type = 'button'; button.setAttribute('aria-label', `查看 ${photo.filename}`);
    const image = photo.has_preview ? photoImage(photo) : node('div', 'thumbnail'); if (!photo.has_preview) image.append(placeholder('本机没有预览')); button.append(image);
    const caption = node('div', 'photo-caption'); caption.append(node('div', 'photo-name', photo.title || photo.filename), node('div', 'photo-subtitle', displayDate(photo.date))); button.append(caption);
    button.addEventListener('click', () => { s.returnPhotos = { photos: state.photos, count: state.count }; state.photos = [...s.detail.photos]; state.count = state.photos.length; openPhoto(index); });
    return button;
  }
  $('#footprint-search').addEventListener('input', event => { s.query = event.target.value.trim(); render().catch(showError); });
  $('#footprint-year').addEventListener('change', event => { s.year = event.target.value; load().catch(showError); });
  $('#footprint-country').addEventListener('change', event => { s.country = event.target.value; render().catch(showError); });
  $('#footprint-provider').addEventListener('change', event => { s.provider = event.target.value; if (s.provider === 'offline') deactivate(); renderMap().catch(showError); });
  $('#footprint-fit').addEventListener('click', fitMap);
  let resizeTimer;
  new ResizeObserver(entries => {
    if (entries[0].contentRect.width > 0 && s.map && s.provider === 'amap' && state.view === 'footprints') {
      clearTimeout(resizeTimer); resizeTimer = setTimeout(fitMap, 120);
    }
  }).observe($('#footprint-amap'));
  $('#footprint-load-more').addEventListener('click', () => selectCity(s.selected.id, false, true).catch(showError));
  $('#footprint-source').addEventListener('click', openSource);
  $('#footprint-make-album').addEventListener('click', () => { if (!s.selected) return; journeyForm({ title: `${s.selected.name}的回忆`, start: s.selected.first_date, end: s.selected.last_date, intro: '', city_id: s.selected.id }); });
  window.PhotoFootprints = { load, deactivate, closePhoto() { if (s.returnPhotos) { state.photos = s.returnPhotos.photos; state.count = s.returnPhotos.count; s.returnPhotos = null; } window.load().catch(showError); } };
})();
