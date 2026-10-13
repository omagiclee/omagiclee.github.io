/* Photo overlays reuse the blog's TravelMapPlatform loader and local AMap settings. */
(() => {
  const $ = selector => document.querySelector(selector);
  let config, map, SDK, detail, overlays = [], points = [], followed, activeMarker, generation = 0;
  let selected = 'amap', loading = false, renderedJourney = '', mapPromise = null;
  try { selected = localStorage.getItem('local-photo-map-provider') || 'amap'; } catch {}
  const ready = fetch('/api/map-config', { cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error('无法读取地图配置');
    return response.json();
  }).then(value => {
    config = value;
    $('#map-provider').querySelector('[value="amap"]').disabled = !value.enabled;
    if (!value.enabled) selected = 'offline';
    $('#map-provider').value = selected;
    paintProvider();
    return value;
  }).catch(() => {
    config = { enabled: false }; selected = 'offline'; $('#map-provider').value = 'offline';
    paintProvider('无法读取地图配置，已切换到离线底图。');
    return config;
  });
  function paintProvider(message = '') {
    const online = selected === 'amap' && Boolean(map) && !loading && detail?.journey.id === renderedJourney && points.length > 0;
    $('#amap-canvas').hidden = !online;
    $('#route-map').toggleAttribute('hidden', online);
    $('#map-attribution').textContent = online ? '高德地图 · 在线街道底图' : 'Natural Earth · 离线底图';
    $('#map-provider-status').textContent = message || (selected === 'amap' ? loading ? '正在加载高德地图…' : '地图底图从高德联网加载，照片文件保留在本机。' : '当前使用离线底图，不通过高德绘制此视图。');
    $('#map-disclaimer').textContent = online ? '连线连接拍摄点，不代表真实步行或驾车轨迹。GPS 坐标在本机转换后显示在高德地图上。' : '连线连接拍摄点，不代表真实步行或驾车轨迹。离线底图不含详细街道。';
  }
  function converted(photo) { return window.coordtransform.wgs84togcj02(photo.location.lon, photo.location.lat); }
  async function createMap() {
    SDK = await window.TravelMapPlatform.loadAmap(config.key, config.securityCode);
    $('#amap-canvas').hidden = false;
    const first = detail.photos.find(photo => photo.location);
    const instance = new SDK.Map('amap-canvas', { viewMode: '2D', zoom: 13, center: first ? converted(first) : [116.397, 39.909], resizeEnable: true, showOversea: true });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('地图加载超时')), 12000);
        instance.on('complete', () => { clearTimeout(timeout); resolve(); });
      });
      map = instance;
    } catch (error) { instance.destroy(); throw error; }
  }
  function makeOverlays() {
    if (!map || !detail) return;
    if (overlays.length) map.remove(overlays);
    overlays = []; points = detail.photos.map((photo, index) => photo.location ? { photo, index, position: converted(photo) } : null).filter(Boolean);
    const step = Math.max(1, Math.ceil(points.length / 500));
    const sampled = points.filter((_, index) => index % step === 0 || index === points.length - 1);
    const full = new SDK.Polyline({ path: points.map(point => point.position), strokeColor: '#779b86', strokeOpacity: .8, strokeWeight: 3, strokeStyle: 'dashed', lineJoin: 'round' });
    followed = new SDK.Polyline({ path: [], strokeColor: '#355e43', strokeWeight: 4, strokeOpacity: 1, lineJoin: 'round' });
    overlays.push(full, followed);
    const occupied = new Set();
    sampled.forEach(({ photo, index, position }) => {
      const cell = position.map(value => Math.round(value * 2000)).join(',');
      if (occupied.has(cell)) return;
      occupied.add(cell);
      const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'amap-photo-pin'; pin.dataset.index = index; pin.setAttribute('aria-label', `第 ${index + 1} 张照片`);
      pin.textContent = '●';
      pin.addEventListener('click', event => { event.stopPropagation(); window.selectMoment(index); });
      const marker = new SDK.Marker({ position, content: pin, offset: new SDK.Pixel(-9, -9), title: `第 ${index + 1} 张照片` });
      overlays.push(marker);
    });
    const active = document.createElement('div'); active.className = 'amap-active-pin'; active.setAttribute('aria-hidden', 'true');
    activeMarker = new SDK.Marker({ position: points[0]?.position || [0, 0], content: active, offset: new SDK.Pixel(-12, -12), zIndex: 200 });
    overlays.push(activeMarker); map.add(overlays); renderedJourney = detail.journey.id;
    fit();
  }
  function fit() {
    if (selected !== 'amap' || !map) return false;
    if (points.length === 1) map.setZoomAndCenter(16, points[0].position);
    else if (points.length) map.setFitView(overlays.filter(item => item !== activeMarker && item !== followed), true, [45, 45, 45, 45], 18);
    return true;
  }
  async function prepare(value) {
    detail = value;
    const request = ++generation;
    await ready;
    if (request !== generation || selected !== 'amap' || !config.enabled || !detail.photos.some(photo => photo.location)) {
      if (!detail.photos.some(photo => photo.location)) destroyMap();
      paintProvider(); return;
    }
    try {
      loading = true; paintProvider();
      if (!map) { if (!mapPromise) mapPromise = createMap().finally(() => { mapPromise = null; }); await mapPromise; }
      if (request !== generation || selected !== 'amap') { if (selected === 'offline') destroyMap(); return; }
      makeOverlays(); loading = false; paintProvider();
    } catch (_) {
      loading = false; selected = 'offline'; $('#map-provider').value = 'offline';
      paintProvider('高德地图暂时无法加载，已切换到离线底图。可重新选择高德地图再试。');
    }
  }
  function draw(index, journeyId) {
    if (selected !== 'amap' || !map || loading || !detail || renderedJourney !== detail.journey.id || journeyId !== detail.journey.id) return false;
    paintProvider();
    $('#map-empty').hidden = points.length > 0;
    followed.setPath(points.filter(point => point.index <= index).map(point => point.position));
    const point = points.find(point => point.index === index);
    if (point) {
      activeMarker.setPosition(point.position); activeMarker.show();
      const bounds = map.getBounds();
      if (bounds && !bounds.contains(point.position)) map.panTo(point.position);
    } else activeMarker.hide();
    return true;
  }
  function destroyMap() { if (map) map.destroy(); map = null; points = []; overlays = []; renderedJourney = ''; loading = false; }
  $('#map-provider').addEventListener('change', async event => {
    selected = event.target.value; ++generation;
    if (selected === 'offline') destroyMap();
    try { localStorage.setItem('local-photo-map-provider', selected); } catch {}
    paintProvider();
    if (detail) await prepare(detail);
    window.drawMap();
  });
  window.PhotoAmap = { prepare, draw, fit, deactivate() { ++generation; destroyMap(); }, zoom(delta) { if (selected !== 'amap' || !map) return false; map.setZoom(map.getZoom() + delta); return true; }, get provider() { return selected; } };
})();
