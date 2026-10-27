# 数据流水线与算子插件前端复刻资料

这份资料用于让另一个 AI 按现有实现复刻 **数据流水线** 和 **算子与插件** 两个前端模块，包括它们的子视图、对话框、异常状态、权限、参数编辑、运行检查与跨页操作。基线是 **2026 年 10 月 28 日的本地工作区文件**，包含当时未提交的改动。

## 找到的位置

`omagiclee.github.io` 中找到的是两篇相关博客；实际交互应用位于相邻的 `data-flywheel` 仓库。当前导航将两个页面归入 **数据开发**。检索页面现在叫 **数据探索**，位于 `/projects/:projectId/explore`，不属于本次要求的两个页面。

| 内容 | 原位置 |
| --- | --- |
| 需求文章，2026 年 10 月 1 日 | `omagiclee.github.io/content/posts/data-flywheel/pipeline-operator-requirements/index.md` |
| 设计评审，2026 年 10 月 7 日 | `omagiclee.github.io/content/posts/data-flywheel/pipeline-plugin-design-review/index.md` |
| 数据流水线页面 | `data-flywheel/apps/web/src/pages/PipelinesPage.tsx` |
| 算子与插件页面 | `data-flywheel/apps/web/src/pages/OperatorsPage.tsx` |

博客是需求与设计背景。**复刻时以资料包中的源码快照为准**，尤其不要把文章提出、但当前页面没有入口的功能当成已经实现。

## 交给另一个 AI 的文件

优先上传整个 zip。先让 AI 阅读下列文件，再按需读取源码。

| 文件 | 用途 |
| --- | --- |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | 页面结构、全部主要功能、交互规则、状态及视觉规格 |
| [CONTRACTS.md](CONTRACTS.md) | 路由、对象、接口、权限、持久化和轮询 |
| [SOURCE_INDEX.md](SOURCE_INDEX.md) | 核心文件、函数入口和原文件行号 |
| [CORE_SOURCE.md](CORE_SOURCE.md) | 两个页面及主要子组件、算法、接口、样式的完整源码合并版 |
| [ACCEPTANCE.md](ACCEPTANCE.md) | 复刻后的逐项验收清单 |
| [SCREENSHOTS.md](SCREENSHOTS.md) | 18 张真实组件截图及场景说明 |
| [verification/TEST_CASES.md](verification/TEST_CASES.md) | 本次通过的 97 项现有测试所在文件及用例标题 |
| [source-manifest.json](source-manifest.json) | 源码版本、文件清单、大小及 SHA-256 |
| [fixtures/README.md](fixtures/README.md) | 临时项目的算子目录样例及截图夹具说明 |

`source/` 保留原仓库目录。为了不遗漏路由懒加载、全局外壳和共享组件，包含完整前端 `apps/web/src`、字体、构建配置、锁文件及浏览器测试。其他业务页面作为依赖背景保留，不代表本次需要复刻所有业务模块。后端只摘录直接相关模块、SDK 和插件样例，**不是独立可启动的完整后端**。

若另一 AI 只能接收少量文本附件，先提供 `README.md`、`IMPLEMENTATION.md`、`CONTRACTS.md`、`CORE_SOURCE.md`；它需要视觉还原时，再提供截图与全局 `App.css`、`fonts.css`、`components/app-shell.css` 和 `components/ui/`。

## 可以直接复制的任务提示

> 请按附件复刻 Data Flywheel 的「数据流水线」和「算子与插件」两个页面，目标是视觉、信息结构和交互尽量与现有实现一致。先读 README、IMPLEMENTATION、CONTRACTS、SOURCE_INDEX、ACCEPTANCE，再读对应 source 文件及截图。源码是最终依据，保留原有中文文案、布局、图标、CSS token、按钮门禁、项目隔离、路由参数、版本规则、异常处理、刷新恢复和移动端抽屉。不要只做两个静态首屏；必须覆盖列表、新建模板、DAG 编排、参数表单与 JSON、撤销重做、校验保存、运行与产物、调试、历史版本、部署，以及算子筛选、插件候选上传、草稿恢复、验证报告、发布和启用。优先复用附件源码与样式。如果目标技术栈不同，按相同行为逐项迁移。后端尚未接入时使用明确标注的可替换 mock adapter，模拟状态变化，不伪称真实执行、验证或发布成功。历史版本比较、恢复、插件退役等当前没有页面入口的功能不要擅自加入。完成后按 ACCEPTANCE 和已有测试验证，并对照截图说明差异。

## 已核对范围

- 阅读两页、子组件、API client、图连接与 Schema 解析、全局视觉及相关后端契约。
- 运行 11 个相关测试文件：**97 项通过**。有既有测试环境警告，详见 [验证记录](verification/RESULTS.md)。
- 用临时 SQLite 数据库及无头 Chromium 采集 18 张截图，捕获的浏览器 `pageerror` 为 0。插件失败／发布、运行／产物场景使用明确标注的合成响应；其余主要使用隔离开发 API。
- 本次没有执行视频模型、真实 wheel 验证或生产部署。截图不能作为这些后端能力的验收结论。

此目录位于博客仓库的 `docs/`，未添加 Hugo 文章或发布线上内容。

## 阅读源码与本地运行

完整前端源码在 `source/apps/web`，原根 package.json 和 package-lock.json 保留在 `source/`。可在解压目录的 `source/` 执行 `npm ci` 安装锁定依赖。已有兼容 API 时，使用 `VITE_API_BASE_URL=<API地址> npm run dev:web` 启动；API 需允许对应前端 origin、会话 cookie 与 CSRF。本资料没有附带现成登录会话。

`tools/capture.cjs` 是截图脚本，依赖隔离的完整开发后端与无头 Chromium，会创建临时流程和注册预装插件；默认端口 18481/18482，不应指向生产。它不是 mock 业务服务器。需要纯前端演示时，由复刻 AI 根据契约另建 mock adapter。

两篇原博客副本放在 `background/`，仅供理解需求背景；`source/` 中 402 个源码、测试、配置和资源文件按 `source-manifest.json` 校验。资料包不包含 node_modules、.env、数据库或模型。
