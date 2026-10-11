(() => {
  const makeButton = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  };

  document.querySelectorAll('.travel-map-widget').forEach(async (root) => {
    const status = root.querySelector('[data-travel-map-status]');
    let config;
    try {
      config = await window.TravelMapPlatform.loadConfig(root.dataset.mapConfig);
    } catch (_) {
      status.textContent = '地图配置无法读取。';
      return;
    }

    root.querySelector('.travel-map-widget__title').textContent = config.title || '旅行地图';
    root.querySelector('.travel-map-widget__description').textContent = config.description || '';
    const tabs = root.querySelector('.travel-map-widget__views');
    const stops = root.querySelector('.travel-map-widget__stops');
    const places = root.querySelector('.travel-map-widget__places');
    const detail = root.querySelector('.travel-map-widget__detail');
    const visitedPanel = root.querySelector('.travel-map-widget__visited');
    visitedPanel.hidden = !Object.keys(config.visited || {}).length;
    let map = null;
    let selected = null;
    let activeView = config.initialView;

    const markSelected = (kind, key) => {
      selected = { kind, key };
      root.querySelectorAll('[data-stop], [data-visited]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset[kind] === key));
      });
    };
    const setView = (view) => {
      if (!config.views[view]) return;
      activeView = view;
      tabs.querySelectorAll('[data-view]').forEach((button) => {
        button.setAttribute('aria-selected', String(button.dataset.view === view));
      });
      map?.setView(view);
    };
    const selectStop = (key) => {
      const item = config.stops[key];
      if (!item) return;
      markSelected('stop', key);
      const view = item.view || Object.keys(config.views).find((name) => config.views[name].stops?.includes(key)) || config.initialView;
      setView(view);
      map?.selectStop(key);
      detail.textContent = item.detail || item.label;
    };
    const selectVisited = (key) => {
      const item = config.visited?.[key];
      if (!item) return;
      markSelected('visited', key);
      setView(Object.keys(config.views).find((name) => config.views[name].showVisited) || config.initialView);
      visitedPanel.open = true;
      map?.selectVisited(key);
      detail.textContent = item.detail || key;
    };

    Object.entries(config.views).forEach(([key, view]) => {
      const button = makeButton(view.label || key, () => setView(key));
      button.dataset.view = key;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(key === config.initialView));
      tabs.append(button);
    });
    Object.entries(config.stops).forEach(([key, stop]) => {
      const button = makeButton(stop.label, () => selectStop(key));
      button.dataset.stop = key;
      button.setAttribute('aria-pressed', 'false');
      stops.append(button);
    });
    Object.entries(config.visited || {}).forEach(([key]) => {
      const button = makeButton(key, () => selectVisited(key));
      button.dataset.visited = key;
      button.setAttribute('aria-pressed', 'false');
      places.append(button);
    });
    status.textContent = '此环境尚未配置高德地图，地点列表仍可查看。';
    if (!root.dataset.amapKey || !root.dataset.amapSecurityCode) return;
    try {
      map = await window.TravelMapPlatform.create(root, config, { selectStop, selectVisited });
      setView(activeView);
      if (selected?.kind === 'stop') map.selectStop(selected.key);
      if (selected?.kind === 'visited') map.selectVisited(selected.key);
    } catch (_) {
      status.textContent = '高德地图暂时无法加载，地点列表仍可查看。';
    }
  });
})();
