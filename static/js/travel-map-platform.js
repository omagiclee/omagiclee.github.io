(() => {
  // Shared map engine. Each article owns its stops, routes, views, and visited places.

  let loaderPromise;
  const loadAmap = (key, securityCode) => {
    if (loaderPromise) return loaderPromise;
    window._AMapSecurityConfig = { securityJsCode: securityCode };
    loaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); reject(new Error('AMap script timeout')); }, 12000);
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=AMap.Driving,AMap.DistrictSearch,AMap.DistrictLayer`;
      script.onload = () => { clearTimeout(timeout); window.AMap ? resolve(window.AMap) : reject(new Error('AMap unavailable')); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('AMap script failed')); };
      document.head.appendChild(script);
    }).catch(error => {
      loaderPromise = null;
      throw error;
    });
    return loaderPromise;
  };

  window.TravelMapPlatform = {
    loadAmap,
    async loadConfig(url) {
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Travel map config unavailable');
      const config = await response.json();
      if (config?.version !== 1 || !config.views || !config.stops) throw new Error('Invalid travel map config');
      return config;
    },
    create: async (root, config, actions = {}) => {
    if (config?.version !== 1 || !config.views || !config.stops) throw new Error('Invalid travel map config');
    const trip = config.stops;
    const visited = config.visited || {};
    const legs = config.roads || [];
    const styles = config.styles || {};
    const initialView = config.initialView || Object.keys(config.views)[0];
    if (styles.markerColor) root.style.setProperty('--travel-map-marker-color', styles.markerColor);
    const container = root.querySelector('[data-travel-map-canvas]');
    const status = root.querySelector('[data-travel-map-status]');
    status.hidden = false;
    status.textContent = '高德地图加载中…';

    try {
      const AMap = await loadAmap(root.dataset.amapKey, root.dataset.amapSecurityCode);
      container.hidden = false;
      container.dataset.loading = 'true';
      const map = new AMap.Map(container, {
        viewMode: '2D', zoom: config.views[initialView].zoom, center: config.views[initialView].center, resizeEnable: true,
        showOversea: true,
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('AMap map timeout')), 12000);
        map.on('complete', () => { clearTimeout(timeout); resolve(); });
      });

      const tripMarkers = new Map();
      const makeMarker = (label, point, onClick, days, stopKey) => {
        const pin = document.createElement('div');
        pin.className = 'travel-map__pin';
        if (stopKey) pin.dataset.stop = stopKey;
        pin.setAttribute('role', 'button');
        pin.setAttribute('tabindex', '0');
        pin.setAttribute('aria-label', `行程第 ${days} 天：${label}`);
        pin.setAttribute('aria-pressed', 'false');
        const number = document.createElement('span');
        number.className = 'travel-map__pin-number';
        number.textContent = `D${days}`;
        const name = document.createElement('span');
        name.className = 'travel-map__pin-name';
        name.textContent = label;
        pin.append(number, name);
        pin.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); }
        });
        const marker = new AMap.Marker({
          position: point, title: label, content: pin,
          offset: new AMap.Pixel(-11, -11),
        });
        marker.on('click', onClick);
        map.add(marker);
        return { marker, pin };
      };
      Object.entries(trip).forEach(([key, item]) => {
        tripMarkers.set(key, makeMarker(item.label, item.point, () => actions.selectStop?.(key), item.days || '', key));
      });
      const connections = (config.connections || []).map((connection) => {
        const from = connection.fromPoint || trip[connection.from]?.point;
        const to = connection.toPoint || trip[connection.to]?.point;
        if (!from || !to) return null;
        const line = new AMap.Polyline({
          path: [from, to], strokeColor: connection.color || styles.connectionColor || '#d78352',
          strokeWeight: 3, strokeOpacity: .85,
          strokeStyle: connection.style || 'solid',
        });
        map.add(line);
        return line;
      }).filter(Boolean);

      let currentView = initialView;
      let planned = false;
      let roadPromise;
      const roads = [];
      const visitedAreas = new Map();
      let selectedPlace = null;
      let areasPlanned = false;
      const countryLayers = new Map();
      Object.entries(visited).forEach(([name, item]) => {
        if (!item.countryCode) return;
        try {
          const layer = new AMap.DistrictLayer.Country({
            SOC: item.countryCode, depth: 0, zIndex: 15, zooms: [2, 15],
          });
          layer.on('click', () => actions.selectVisited?.(name));
          map.add(layer);
          countryLayers.set(name, layer);
        } catch (_) { /* Other areas remain usable if one country layer fails. */ }
      });
      const paintVisitedAreas = () => {
        countryLayers.forEach((layer, name) => {
          layer.setStyles({
            fill: selectedPlace === name ? (styles.visitedSelectedFill || 'rgba(12, 120, 130, 0.68)') : (styles.visitedFill || 'rgba(73, 168, 170, 0.42)'),
            'nation-stroke': styles.visitedStroke || '#187780',
            'coastline-stroke': styles.visitedStroke || '#187780',
            'province-stroke': '',
          });
        });
        visitedAreas.forEach((polygons, city) => polygons.forEach((polygon) => {
          const selected = city === selectedPlace;
          polygon.setOptions({
            fillColor: selected ? (styles.visitedSelectedColor || '#0c7882') : (styles.visitedColor || '#49a8aa'),
            fillOpacity: selected ? .68 : .42,
            strokeColor: selected ? (styles.visitedSelectedStroke || '#075c65') : (styles.visitedStroke || '#20818a'),
            strokeWeight: selected ? 2.5 : 1.5,
          });
        }));
      };
      paintVisitedAreas();
      const loadVisitedAreas = async () => {
        if (areasPlanned) return;
        areasPlanned = true;
        let succeeded = countryLayers.size;
        for (const [city, item] of Object.entries(visited)) {
          if (!item.adcode) continue;
          await new Promise((resolve) => setTimeout(resolve, 400));
          const district = new AMap.DistrictSearch({
            level: item.level, subdistrict: 0, extensions: 'all',
          });
          const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 10000);
            district.search(item.adcode, (state, value) => {
              clearTimeout(timeout);
              resolve(state === 'complete' ? value : null);
            });
          });
          const boundaries = result?.districtList?.[0]?.boundaries;
          if (!boundaries?.length) continue;
          const polygons = boundaries.map((boundary) => {
            const polygon = new AMap.Polygon({
              path: boundary, zIndex: 20,
              fillColor: styles.visitedColor || '#49a8aa', fillOpacity: .42,
              strokeColor: styles.visitedStroke || '#20818a', strokeWeight: 1.5,
              strokeOpacity: .95, cursor: 'pointer',
            });
            polygon.on('click', () => actions.selectVisited?.(city));
            polygon.on('mouseover', () => {
              if (city !== selectedPlace) polygon.setOptions({ fillOpacity: .58, strokeWeight: 2.5 });
            });
            polygon.on('mouseout', paintVisitedAreas);
            map.add(polygon);
            if (!config.views[currentView].showVisited) polygon.hide();
            return polygon;
          });
          visitedAreas.set(city, polygons);
          succeeded += 1;
        }
        paintVisitedAreas();
        if (config.views[currentView].showVisited && succeeded !== Object.keys(visited).length) {
          status.hidden = false;
          status.textContent = `已点亮 ${succeeded}/${Object.keys(visited).length} 处足迹；其余边界暂不可用。`;
        }
      };
      const planRoads = async () => {
        if (planned) return;
        planned = true;
        status.hidden = !config.views[currentView].showRoads;
        status.textContent = '正在读取驾车路线…';
        const driving = new AMap.Driving({ policy: 0 });
        let succeeded = 0;
        for (const [index, leg] of legs.entries()) {
          if (index) await new Promise((resolve) => setTimeout(resolve, 400));
          const result = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 10000);
            driving.search([
              { keyword: leg.fromName, city: leg.fromCity },
              { keyword: leg.toName, city: leg.toCity },
            ], (state, value) => {
              clearTimeout(timeout);
              resolve(state === 'complete' ? value : null);
            });
          });
          const route = result?.routes?.[0];
          const metric = root.querySelector(`[data-road-metric="${CSS.escape(leg.key)}"]`);
          if (metric && Number.isFinite(Number(route?.distance)) && Number.isFinite(Number(route?.time))) {
            const multiplier = leg.roundTrip ? 2 : 1;
            const km = Math.round(Number(route.distance) * multiplier / 1000);
            const mins = Math.round(Number(route.time) * multiplier / 60);
            metric.textContent = `约 ${km} 公里 · ${mins >= 60 ? `${Math.floor(mins / 60)} 小时${mins % 60 ? ` ${mins % 60} 分` : ''}` : `${mins} 分钟`}${leg.roundTrip ? '（往返估算）' : ''}`;
          }
          const path = route?.steps?.flatMap((step) => step.path || []) || [];
          if (path.length < 2) continue;
          const line = new AMap.Polyline({
            path, strokeColor: styles.roadColor || '#dc7047', strokeWeight: 4,
            strokeOpacity: .85, lineJoin: 'round', showDir: false,
          });
          line.on('click', () => actions.selectStop?.(leg.to));
          roads.push(line);
          map.add(line);
          if (result.origin) tripMarkers.get(leg.from)?.marker.setPosition(result.origin);
          if (result.destination) tripMarkers.get(leg.to)?.marker.setPosition(result.destination);
          succeeded += 1;
        }
        roads.forEach((road) => road.hide());
        if (config.views[currentView].showRoads) roads.forEach((road) => road.show());
        status.textContent = succeeded === legs.length
          ? '实线为高德驾车规划路线；实际行驶以出行当天导航为准。'
          : `已加载 ${succeeded}/${legs.length} 段驾车路线；其余路线暂不可用。`;
        status.hidden = !config.views[currentView].showRoads;
      };

      const adapter = {
        setView(view) {
          if (!config.views[view]) return;
          currentView = view;
          root.dataset.activeView = view;
          const viewConfig = config.views[view];
          visitedAreas.forEach((polygons) => polygons.forEach((polygon) => viewConfig.showVisited ? polygon.show() : polygon.hide()));
          countryLayers.forEach((layer) => layer.setMap(viewConfig.showVisited ? map : null));
          tripMarkers.forEach(({ marker }, key) => {
            viewConfig.stops?.includes(key) ? marker.show() : marker.hide();
          });
          connections.forEach((line) => viewConfig.showConnections ? line.show() : line.hide());
          roads.forEach((road) => viewConfig.showRoads ? road.show() : road.hide());
          status.hidden = !viewConfig.showRoads || !planned;
          map.setZoomAndCenter(viewConfig.zoom, viewConfig.center, true);
          if (!roadPromise && legs.length) roadPromise = planRoads().catch(() => {
            status.hidden = false;
            status.textContent = '驾车路线暂时无法读取，可继续查看景点位置。';
          });
          if (!areasPlanned) void loadVisitedAreas().catch(() => {
            if (config.views[currentView].showVisited) {
              status.hidden = false;
              status.textContent = '部分足迹边界暂时无法读取。';
            }
          });
        },
        selectStop(key) {
          tripMarkers.forEach(({ pin }) => { pin.classList.remove('is-selected'); pin.setAttribute('aria-pressed', 'false'); });
          selectedPlace = null;
          paintVisitedAreas();
          const item = tripMarkers.get(key);
          if (!item) return;
          item.pin.classList.add('is-selected');
          item.pin.setAttribute('aria-pressed', 'true');
          if (trip[key].focusOnSelect !== false) {
            map.setZoomAndCenter(trip[key].focusZoom || 10, item.marker.getPosition());
          }
        },
        selectVisited(city) {
          tripMarkers.forEach(({ pin }) => { pin.classList.remove('is-selected'); pin.setAttribute('aria-pressed', 'false'); });
          const item = visited[city];
          if (!item) return;
          selectedPlace = city;
          paintVisitedAreas();
          map.setZoomAndCenter(item.focusZoom || (item.level === 'country' ? 5 : item.level === 'province' ? 6 : 7), item.point);
        },
        resize() { /* resizeEnable watches the expanded container. */ },
      };
      delete container.dataset.loading;
      status.hidden = true;
      return adapter;
    } catch (error) {
      container.hidden = true;
      status.hidden = false;
      throw error;
    }
    },
  };
})();
