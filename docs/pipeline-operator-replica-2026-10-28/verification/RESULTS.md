# 核对记录

日期：2026-10-28，Asia/Shanghai。基线：本地当前工作区，源码哈希见 `../source-manifest.json`。

## 组件与逻辑测试

在原 `data-flywheel/apps/web` 执行：

```sh
npm test -- --reporter=dot \
  src/pages/PipelineWorkspace.test.tsx \
  src/pages/PipelineEditorReview.test.tsx \
  src/pages/PipelinesProjectScope.test.tsx \
  src/pages/PipelinesRunDetail.test.tsx \
  src/pages/PluginDevelopment.test.tsx \
  src/components/PipelineCanvas.test.ts \
  src/components/PipelineCanvasInteractions.test.tsx \
  src/components/PipelineDebugControls.test.tsx \
  src/components/PipelineDeployments.test.tsx \
  src/components/ArtifactDatasetActions.test.tsx \
  src/pipeline-schema.test.ts
```

结果：**11 个测试文件通过，97 项测试通过，进程退出码 0**。Vitest 运行时版本为 4.1.11，耗时 3.84 秒。测试多使用隔离 MSW API，不执行实际 wheel 或视频模型。

运行中出现 Node localStorage experimental warning、React act 环境警告，以及一个空算子库用例的 MSW `operator-plugins` 未匹配请求警告；这些未导致用例失败。不能将其概括成完全无警告的全栈验收。

## 浏览器参考截图

运行 `tools/capture.cjs`，使用全新 Chromium context，headless、zh-CN、Asia/Shanghai、reduced-motion。独立 Vite 端口 18482，独立开发 API 端口 18481；SQLite、对象与媒体目录均在 `/tmp/flywheel-replica-20261028*`，与原应用数据隔离。

通过真实临时 API 创建模板和注册内置文档算子，未启动模型运行。插件验证/发布和运行产物状态使用浏览器路由合成响应，文件名含 `fixture`，用于查看真实 React 组件的条件渲染，不是后端执行证据。详情见 `screenshots.json` 与 `../fixtures/visual-fixtures.json`。

采集 18 个场景，浏览器 `pageerror` 数为 0。桌面视口 1440×1000，移动视口 390×844；桌面截图可长于视口，因为保留整页内容。

## 本次没有验证的范围

没有执行全仓库测试、生产部署、实际视频模型推理、上传 wheel 的真实容器验证、真实运行到数据集的全栈闭环。本次目标是提取和说明前端实现，并核对对应组件行为与截图。

## 打包完整性

`package-audit.json` 记录：402 个快照文件的 SHA-256 与清单一致；前端源码相对导入无缺失；主要说明文档本地链接无失效；18 张截图存在。原业务源文件未因本次资料整理而修改。
