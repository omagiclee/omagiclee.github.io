# 博客旅行地图组件

地图按三层组织：

1. `static/js/travel-map-platform.js` 是共享的高德 2D 引擎，负责地图加载、行程点、示意连接线、驾车路线、城市和国家边界、视角切换与选中状态。
2. 每篇文章自己的 `travel-map.json` 只存地图数据和可选配色。
3. `{{< travel-map src="travel-map.json" >}}` 提供通用界面。需要特殊排版的文章可以使用自己的 shortcode 和控制脚本，仍调用同一引擎。宁夏文章的 `ningxia-route` 就是这个例子。

## 新文章接入

在文章的 page bundle（`index.md` 所在目录）创建 `travel-map.json`，然后在正文插入：

```go-html-template
{{< travel-map src="travel-map.json" label="我的旅行地图" >}}
```

最小配置：

```json
{
  "version": 1,
  "title": "上海周末行",
  "description": "点击站点查看安排",
  "initialView": "overview",
  "views": {
    "overview": {
      "label": "总览",
      "center": [121.47, 31.23],
      "zoom": 10,
      "stops": ["station", "museum"],
      "showConnections": true
    }
  },
  "stops": {
    "station": {
      "label": "虹桥站",
      "days": "1",
      "point": [121.327, 31.195],
      "detail": "到站后前往酒店"
    },
    "museum": {
      "label": "博物馆",
      "days": "2",
      "point": [121.475, 31.235],
      "detail": "上午参观"
    }
  },
  "connections": [
    { "from": "station", "to": "museum", "style": "dashed" }
  ]
}
```

坐标使用经度、纬度顺序。一个配置可有多个视角；`views` 中的 `stops` 决定该视角展示哪些行程点。`showVisited`、`showConnections`、`showRoads` 控制对应图层。行程点可以设置 `view`、`focusZoom`，或用 `focusOnSelect: false` 保持当前视角。

可选的 `roads` 使用 `key`、`from`、`to`、`fromName`、`toName`、`fromCity`、`toCity` 和 `roundTrip`。引擎向高德请求驾车规划；若界面中有 `data-road-metric="key"` 元素，会自动写入公里数与耗时。跨城航班、铁路等无法由驾车规划表达的路段用 `connections` 做示意线；每端可以是站点 ID 或 `fromPoint`/`toPoint` 坐标。

`visited` 可按城市行政区 `adcode`、`level`（`city` 或 `province`）点亮，也可按国家三字母 `countryCode`、`level: "country"` 点亮。每项需要 `point` 供点击聚焦；可加 `detail` 和 `focusZoom`。这份足迹只来自文章配置，不读取高德个人账号历史。

`styles` 可覆盖 `markerColor`、`connectionColor`、`roadColor`、`visitedColor`、`visitedStroke`、`visitedSelectedColor`、`visitedSelectedStroke`、`visitedFill` 和 `visitedSelectedFill`。其中两个 Fill 字段用于国家图层，接受 CSS 颜色值。

## 自定义界面接口

自定义 shortcode 只需提供：

```html
<section data-map-config="/文章路径/travel-map.json"
  data-amap-key="..." data-amap-security-code="...">
  <div data-travel-map-canvas hidden></div>
  <p data-travel-map-status></p>
</section>
```

页面加载共享脚本后调用：

```js
const config = await TravelMapPlatform.loadConfig(root.dataset.mapConfig);
const map = await TravelMapPlatform.create(root, config, {
  selectStop: (id) => {},
  selectVisited: (name) => {}
});
map.setView(config.initialView);
map.selectStop("station");
map.selectVisited("上海");
```

两个回调处理地图上的点击；返回对象处理文章按钮发起的视角与选择。示例可看宁夏文章的 `route-map.js`。

## 本地预览与发布

本地预览运行 `scripts/preview-travel-map.sh`；旧的 `scripts/preview-ningxia-amap.sh` 仍可用。脚本从未提交的 `.env.amap.local` 读取高德 Web JS API Key 和安全密钥。安全密钥不应写入 JSON、正文或 Git。当前静态发布构建不注入凭据，因此地图界面只显示地点列表和说明；正式启用在线地图需要服务端安全代理。地图底图、行政边界和驾车规划均依赖高德服务，出行耗时会随请求日期变化。
