+++
date = '2026-09-06T00:06:00+08:00'
draft = false
isCJKLanguage = true
title = '数据平台前后端技术框架选型：React、Vite 与 FastAPI 的适用边界'
description = '基于 Data Flywheel 实际代码和技术讨论，解释前端状态分工、API 与计算隔离、权限、数据存储及从 MVP 到产品化的演进。'
categories = ['数据平台']
tags = ['数据平台', '技术选型', 'React', 'Vite', 'FastAPI', '系统架构']
featured = false
+++

技术选型应该从产品的工作负载和团队能力出发。数据平台既有列表、表单与权限，也有视频处理、模型推理和长时间运行的任务；用“哪个框架最顶级”来统一回答这些问题，容易忽略真正的系统边界。

Data Flywheel 目前选择了 **React + TypeScript + Vite 前端，以及 FastAPI 后端**。结合代码和“数据飞轮平台：技术选型与设计系统”讨论，我认为这套组合适合作为当前产品基础。本文解释理由与代价，并区分 2026-09-06 阅读到的实现和后续建议，不将未来的跨企业平台能力视为已经完成。

<!--more-->

## 1. 从需求倒推，而不是从框架排名开始

当前产品的主要约束包括：

- 登录后的企业工作台，复杂列表、筛选和详情比公共页面 SEO 更关键。
- Python 算法与数据生态占比高，需要接入模型服务和批量处理。
- 后续可能出现视频时间轴、标注画布和插件面板，基础组件要可组合。
- 需要项目范围的权限、审计、可靠任务与版本化数据。
- 团队要能逐步交付，避免第一版就维护大量服务与框架。

这些条件支持前后端分离和模块化起步。它们不能推导出 React 或 FastAPI 在所有平台中最好，也不能替代容量与恢复测试。

## 2. 代码里实际采用了什么

以下来自 `apps/web/package.json`、`apps/api/requirements.txt` 和对应源文件。包清单存在版本范围，本文不把声明范围当成已安装精确版本，也不宣称它们都是当前最新版本。

| 层次 | 当前实现 | 主要职责 |
| --- | --- | --- |
| 页面基础 | React、TypeScript、Vite | 组件、类型、开发与构建 |
| 路由 | TanStack Router | 路径、页面加载、路由上下文 |
| 服务端数据状态 | TanStack Query | 查询缓存、加载、失效与刷新 |
| 基础 UI | shadcn 风格本地组件、Base UI、Tailwind | 可组合交互与样式 |
| 数据网格 | AG Grid Community | 事件表格 |
| 表单 | React Hook Form、Zod | 输入状态与前端校验 |
| 前端验证 | Storybook、Vitest、Playwright、MSW | 组件展示、测试与接口模拟 |
| API | FastAPI、SQLAlchemy | 接口校验、数据访问与业务流程 |
| 身份与授权 | Keycloak、服务端 Cookie 会话、PyCasbin | 登录、角色、作用域与代登录 |
| 存储与开发环境 | SQLite 默认开发配置、PostgreSQL 配置、Compose | 本地启动与数据库基础设施 |

当前源代码包含看板、事件、用户权限管理、需求列表与详情。它仍是正在演进的产品骨架；已有看板中的阶段与指标展示，不代表背后所有训练、索引、发布系统均已接通。

## 3. 为什么当前选 Vite，而不是默认改成 Next.js

Vite 提供开发服务器与构建工具链，适合当前独立 API 的前端工程。参见 [Vite 官方介绍](https://vite.dev/guide/)。它本身不包办认证、业务 API、数据库和任务系统。

Next.js 提供服务器与客户端组件等全栈渲染能力，适合需要组合服务端渲染、页面数据获取与客户端交互的产品。参见 [Next.js Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)。它也可以建设后台工作台，不能简单说“只能用于内容网站”。

| 产品条件 | 本文的选型判断 |
| --- | --- |
| 以内部工作台为主，已有 Python API | Vite SPA 可以保持前后端边界清晰 |
| 公共内容、SEO 与服务端页面渲染成为主要需求 | 重新评估 Next.js 等全栈框架的收益 |
| 团队深度使用 Vue，已有成熟公共组件 | 保留 Vue 也可能比迁移 React 更合理 |
| 大量特殊交互与专业画布 | 重点验证组件与渲染方案，不能只比较脚手架 |

当前没有必要仅为了“企业级”标签引入额外 Node 服务端。未来出现明确需求时，也可以把公共站点与登录后的工作台分开部署。

## 4. Router、Query、表单与全局状态各管一件事

前端最容易出现的复杂性之一，是把同一份状态同时存进多个位置。

| 状态 | 建议归属 | 例子 |
| --- | --- | --- |
| 可分享导航状态 | URL 与 Router | 当前项目、列表筛选、分页、详情 ID |
| 后端返回的资源 | Query | 需求列表、用户能力、任务状态 |
| 正在编辑的输入 | 表单 | 新建需求、算子参数、错误信息 |
| 页面临时交互 | 局部 React 状态 | 弹窗开关、面板展开、未提交选择 |
| 跨页面稳定 UI 偏好 | 小范围共享状态 | 密度、主题、布局偏好 |

当前 `router.tsx` 利用 loader 预取数据，页面使用 Query，表单使用 React Hook Form + Zod。这已经形成了相对明确的分工，无需为了框架清单完整而立即增加一个全局状态库。

Query Key 应包含会改变返回结果的变量，参见 [TanStack Query Keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)。下面是**多项目扩展建议**，不是当前代码摘录：

```ts
const requirementKey = (
  projectId: string,
  effectiveUserId: string,
  status: string,
) => ["requirements", { projectId, effectiveUserId, status }] as const;
```

未来切换项目、用户或代登录状态时，应清理或隔离旧查询结果。缓存键帮助避免数据混用，但安全边界仍由后端执行。

## 5. 为什么选 shadcn/Base UI，以及要承担什么

项目需要深度定制工作台，因此选择本地可维护的基础组件具有合理性。但源码可控不等于维护免费：组件升级、语义一致性、键盘交互与视觉回归需要明确负责人。

如果未来大部分需求只是标准企业表单与资源列表，整体采用维护成熟的配套组件体系也值得评估。反过来，频繁修改 DOM 结构、复合交互和插件插槽时，当前组合的自主性更有价值。

AG Grid Community 已用于事件列表。是否要采用高级功能，应依据具体功能与授权边界核对，不把所有网格能力都当作 Community 自带。参见 [AG Grid Community 与 Enterprise 对比](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/)。

组件库选择不决定平台能运行多少 GPU 任务，也不决定后端是否支持插件。它主要影响 UI 实现自由度与维护方式，视觉主规范另见 [UI 设计讨论]({{< relref "/posts/ai-data/data-platform/ui-design-guidelines/index.md" >}})。

## 6. FastAPI 负责控制，重计算独立执行

FastAPI 提供 OpenAPI、JSON Schema 与基于类型声明的数据校验能力，适合 Python 生态中的接口开发。参见 [FastAPI Features](https://fastapi.tiangolo.com/features/)。但数据库迁移、授权规则、任务可靠性和数据治理仍需要平台自己组织。

建议的长期边界是：

{{< platform-diagram >}}
flowchart TD
    A[React 工作台] --> B[FastAPI 控制 API]
    B --> C[身份与授权]
    B --> D[元数据与任务记录]
    B --> E[任务队列或编排服务]
    E --> F[CPU 或 GPU Worker]
    F --> G[对象存储与派生数据]
    F --> H[索引与模型服务]
    B -->|授权查询| H
{{< /platform-diagram >}}

API 接收配置、检查权限、创建任务并返回任务 ID；视频解码、转码、Embedding、批量推理进入独立执行环境。大文件通过授权的数据通道传输，避免全部经 JSON API 和主进程搬运。

这些边界如何映射为服务副本、CPU/GPU Job 与任务状态对账，见 [Data Flywheel 的 Kubernetes 架构]({{< relref "/posts/ai-data/data-platform/kubernetes/index.md" >}})。

`async def` 适合协调异步 I/O，不会自动把 CPU 解码或 GPU 推理变成轻量操作。FastAPI 的 BackgroundTasks 也不是持久化分布式队列，官方针对重型计算提示考虑独立任务工具。参见 [Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)。

队列、批调度、分布式计算和长流程编排应按运行语义选型：是否需要检查点、任务依赖、资源排队、人工等待、取消与对账。先定义这些要求，再选择具体引擎，避免仅因“能异步”就认定满足生产任务需求。

## 7. 后端替代方案与存储边界

框架比较应包含团队与业务条件：

| 方向 | 值得选择的条件 | 当前项目中的判断 |
| --- | --- | --- |
| FastAPI | Python 数据生态、独立 API、需要灵活组合 | 与现有代码和算法能力衔接直接 |
| Django | 强调配套管理后台与完整 Web 应用体系 | 可以评估，但迁移需有明确收益 |
| Java / Spring | 组织已有 Java 基础设施与治理体系 | 可承担平台服务，无需为标签而切换 |
| Go | 特定服务强调资源效率与并发控制 | 可在测出瓶颈后独立引入 |
| Node / TypeScript 后端 | 团队希望统一语言与 Web 协作 | 合理候选，仍需独立接入 Python 计算 |

这是职责与团队适配判断，不是未经测量的性能排名。

数据存储同样按用途分工：关系数据库保存资产元数据、授权、任务与审计；对象存储保存原始与派生文件；索引服务负责检索；缓存只保存可重建的加速数据。模型权重、索引版本和大文件不应因为方便就塞进同一张业务表。

当前 SQLite 有利于快速本地启动，PostgreSQL 已有配置基础。上线前应在目标数据库运行迁移、事务、并发和备份恢复验证；存在 Compose 文件不代表已经验证生产一致性。

## 8. 从 MVP 到多客户产品，需要增加什么

讨论中曾提出跨企业复用的目标。更稳妥的路线是保持同一套核心，通过领域模块、连接器和配置适配客户，而不是每个客户维护长期分支。

建议分阶段建设：

1. **当前阶段**：完善已有登录、权限、需求与事件闭环，保持模块边界清晰。
2. **真实数据阶段**：增加资产与数据集版本、持久化任务、幂等结果提交、可追踪血缘。
3. **独立部署阶段**：固化配置、数据库迁移、备份恢复、离线资源与升级流程。
4. **跨客户复用阶段**：验证项目／租户隔离、插件兼容、配额、客户配置和版本支持策略。

多客户产品不等于第一天所有客户共用数据库。先做单客户独立部署，同时让接口和模型意识到租户边界，是一种可行路径。隔离要覆盖存储、索引、缓存、任务和下载，不能只增加一个 `tenant_id` 字段。

当前前端有锁文件、测试与 Storybook 基础，后端使用版本范围依赖。后续应固化可复现的依赖环境，补上目标数据库迁移、持续集成与恢复演练；不要把其他任务里某次通过的测试当成本文对当前系统的完整验证。

## 9. 怎样记录一次可复查的选型

建议使用简短 ADR：背景与约束、候选方案、最终决定、承担的代价、验证方法、重新评估触发条件。

例如，当前决定保留 Vite + React + FastAPI；承担前后端契约与公共组件维护成本；验证真实页面响应、接口契约、任务恢复与权限边界；当公共页面服务端渲染、团队技能或计算负载发生显著变化时再评估。

这套框架可以继续承载 Data Flywheel 的演进。接下来最需要验证的是 [插件执行与结果管理]({{< relref "/posts/ai-data/data-platform/operator-as-plugin/index.md" >}})、[权限隔离]({{< relref "/posts/ai-data/data-platform/access-control/index.md" >}}) 和 [生产发布流程]({{< relref "/posts/ai-data/data-platform/release-environments/index.md" >}})，而不是不断更换框架名称。
