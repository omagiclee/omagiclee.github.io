(() => {
  const stops = {
    home: ['10 月 1 日', '从吴江太湖新城出发', '可到苏州南站，或经流虹路地铁站前往苏州站；高铁到上海虹桥后衔接航班。只有航班从虹桥机场起飞时，这条接驳路线才直接适用。', 'china'],
    yinchuan: ['10 月 1—3 日、6 日', '银川作为前后两个住宿基地', '抵达后不赶景点。前 3 晚玩银川周边，返程前再住 1 晚，为天气和航班留余地。', 'ningxia'],
    shahu: ['10 月 2 日', '沙湖：湖、芦苇与沙地', '上午去沙湖，以坐船、看湖和轻松玩沙为主；午后回银川休息，不把这天塞满。', 'ningxia'],
    zhenbeibao: ['10 月 3 日', '镇北堡：贺兰山脚下', '上午逛西部影城；孩子状态好再考虑贺兰山岩画。岩画是可删项。', 'ningxia'],
    zhongwei: ['10 月 4—6 日', '中卫连住两晚', '从银川转往中卫，吴忠早茶可顺路体验。中卫先住市区，降低带娃换酒店和吃饭的难度。', 'ningxia'],
    shapotou: ['10 月 5 日', '沙坡头：黄河与沙漠', '保留完整一天，先看风景再玩沙。骑骆驼、滑沙等项目按当天开放情况和孩子的年龄、身高要求决定。', 'ningxia'],
  };

  document.querySelectorAll('.nx-route').forEach((root) => {
    let liveMap = null;
    const tabs = [...root.querySelectorAll('[data-view]')];
    const stopButtons = [...root.querySelectorAll('.nx-route__stops [data-stop]')];
    const dayButtons = [...root.querySelectorAll('[data-day-stop]')];
    const cityButtons = [...root.querySelectorAll('.nx-route__cities [data-city]')];
    const departureButtons = [...root.querySelectorAll('[data-departure]')];
    const departureText = root.querySelector('.nx-route__departure-text');
    const date = root.querySelector('.nx-route__detail-date');
    const title = root.querySelector('.nx-route__detail-title');
    const text = root.querySelector('.nx-route__detail-text');
    const expand = root.querySelector('.nx-route__expand');
    const visited = root.querySelector('.nx-route__visited');
    const status = root.querySelector('.nx-route__map-status');

    const markMapUnavailable = (message) => {
      root.classList.add('nx-route--map-unavailable');
      status.hidden = false;
      status.textContent = message;
    };

    const setView = (view) => {
      tabs.forEach((tab) => { tab.setAttribute('aria-selected', String(tab.dataset.view === view)); });
      liveMap?.setView(view);
    };

    const clearSelection = () => {
      stopButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
      cityButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
    };

    const selectStop = (key) => {
      const item = stops[key];
      if (!item) return;
      clearSelection();
      root.dataset.selectionKind = 'trip';
      setView(item[3]);
      stopButtons.find((button) => button.dataset.stop === key)?.setAttribute('aria-pressed', 'true');
      liveMap?.selectStop(key);
      date.textContent = item[0];
      title.textContent = item[1];
      text.textContent = item[2];
    };

    const selectCity = (city) => {
      clearSelection();
      root.dataset.selectionKind = 'visited';
      setView('china');
      visited.open = true;
      cityButtons.find((button) => button.dataset.city === city)?.setAttribute('aria-pressed', 'true');
      liveMap?.selectVisited(city);
      date.textContent = city === '泰国' ? '已去过的国家' : '已去过的城市';
      title.textContent = city;
      text.textContent = city === '泰国'
        ? '泰国是你提供的旅行足迹。地图按国家边界点亮，不代表去过泰国每个地区。'
        : '这座城市是你提供的旅行足迹。地图按高德行政区边界点亮：直辖市用全市边界，其他用地级市边界；不代表边界内每个地方都去过。';
    };

    tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
    stopButtons.forEach((button) => button.addEventListener('click', () => selectStop(button.dataset.stop)));
    dayButtons.forEach((button) => button.addEventListener('click', () => selectStop(button.dataset.dayStop)));
    cityButtons.forEach((button) => button.addEventListener('click', () => selectCity(button.dataset.city)));
    departureButtons.forEach((button) => button.addEventListener('click', () => {
      departureButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      departureText.textContent = button.dataset.departure === 'south'
        ? '太湖新城开车或打车到苏州南站，再乘高铁到上海虹桥站。'
        : '太湖新城打车到苏州站；也可先打车到流虹路站，乘地铁 4 号线到苏州站，再换高铁到上海虹桥站。';
    }));
    const closeExpanded = () => {
      root.classList.remove('nx-route--expanded');
      expand.textContent = '放大地图';
      expand.setAttribute('aria-pressed', 'false');
    };
    expand.addEventListener('click', () => {
      const expanded = root.classList.toggle('nx-route--expanded');
      expand.textContent = expanded ? '收起地图' : '放大地图';
      expand.setAttribute('aria-pressed', String(expanded));
      liveMap?.resize();
    });
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && root.classList.contains('nx-route--expanded')) closeExpanded();
    });

    if (window.TravelMapPlatform && root.dataset.amapKey && root.dataset.amapSecurityCode) {
      window.TravelMapPlatform.loadConfig(root.dataset.mapConfig).then((config) => {
        return window.TravelMapPlatform.create(root, config, { selectStop, selectVisited: selectCity });
      }).then((adapter) => {
        liveMap = adapter;
        liveMap.setView(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.view || 'china');
        const selectedCity = cityButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
        const selectedStop = stopButtons.find((button) => button.getAttribute('aria-pressed') === 'true');
        if (selectedCity) liveMap.selectVisited(selectedCity.dataset.city);
        else if (selectedStop && selectedStop.dataset.stop !== 'home') liveMap.selectStop(selectedStop.dataset.stop);
      }).catch(() => {
        markMapUnavailable('高德地图暂时无法加载，行程顺序和地点说明仍可查看。');
      });
    } else markMapUnavailable('此环境尚未配置高德地图，行程顺序和地点说明仍可查看。');
  });
})();
