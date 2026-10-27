+++
date = '2026-10-28T00:00:00+08:00'
draft = false
isCJKLanguage = true
contentLanguage = 'zh-CN'
title = 'Airflow Argo Dagster 对比与数据飞轮平台选型'
description = '比较 Airflow、Argo Workflows、Dagster、Prefect、Flyte、Temporal、Kubeflow Pipelines、Kestra、DolphinScheduler 和 Metaflow，结合影像 AutoGT 与 Data Flywheel 的现有代码给出选型及演进方案。'
summary = '推荐以 Dagster OSS 作为 Data Flywheel 的主编排，保留平台自己的版本、权限与发布门禁；先完善资产映射和执行协议，再按实际负载扩展 Docker 或 Kubernetes。'
categories = ['数据飞轮']
tags = ['工作流编排', '技术选型', '数据平台']
featured = false
+++

**Data Flywheel 继续选择 Dagster OSS 作为主编排最合适。** 保留 React Flow 画布、FastAPI 控制面和 Python 算子 SDK，把下一阶段投入放在数据资产映射、分区恢复、质量门禁与真实执行资源上。现有 Docker 执行路径可以继续完善；需要 Kubernetes 时，先评估 Dagster 的原生集成。

这个判断来自平台的主要交付物：可追溯的图像与视频数据、AutoGT 配对、审核结果和正式数据集版本。Argo Workflows 更适合以容器任务为中心的 Kubernetes 工作负载；Temporal 更适合跨服务、跨天等待的业务流程。两者都有价值，但当前没有必要与 Dagster 同时承担整条流水线的调度。

本文比较十个有代表性的框架。资料核验于 **2026 年 10 月 28 日**，项目现状以当日本地工作区为准，包含未提交实现。框架能力来自官方文档，适配结论属于针对本平台的工程判断；性能与恢复能力的验收方案放在文末。

<!--more-->

## 1 先分清几种不同的编排问题

这里将提问中的 **argoflow** 按 **Argo Workflows** 理解。Argo Workflows 管理 Kubernetes 上的工作流；[Argo CD](https://argo-cd.readthedocs.io/en/stable/)主要负责 GitOps 应用交付；[Kubeflow Pipelines](https://www.kubeflow.org/docs/components/pipelines/overview/)提供面向 ML 的组件、流水线和运行体系。这三个名字不应混用。

同一条影像数据生产链，会遇到四类问题：

| 问题 | 影像平台中的例子 | 优先关注的抽象 |
| --- | --- | --- |
| 数据应该处于什么状态 | 哪些源图已生成新版配对，哪些批次缺质量报告 | 资产、依赖、分区、检查 |
| 计算应该在哪里执行 | 解码用 CPU，模型推理用 GPU，不同算子依赖不同镜像 | 容器、任务资源、队列、执行环境 |
| 业务应该走到哪一步 | 等待人工审核，退回修订，满足条件后发布 | 持久状态、事件、审批、补偿 |
| 算法内部怎样跑得更快 | 模型驻留、动态批处理、并行解码 | 算法执行器、数据传输、批次与检查点 |

编排器决定执行顺序和恢复方式；具体吞吐还取决于模型加载、存储、网络和计算实现。把每张图拆成一个调度任务，可能增加启动和状态管理成本，不能据此推导出更高吞吐。

{{< mermaid >}}
flowchart LR
    A[主要交付对象] --> B[数据资产与版本]
    A --> C["Kubernetes<br/>容器任务"]
    A --> D[持久业务流程]
    A --> E[算法研发流程]
    B --> B1["Dagster / Airflow<br/>Prefect"]
    C --> C1[Argo Workflows]
    D --> D1[Temporal]
    E --> E1["Flyte / Metaflow<br/>Kubeflow Pipelines"]
{{< /mermaid >}}

这是选择入口，各框架的能力有重叠。例如 Prefect 可以等待人工输入，Airflow 可以编排模型训练，Flyte 也可以运行一般数据流程。Kestra 与 DolphinScheduler 则适合从声明式配置、可视化任务平台的角度评估。

## 2 平台现状决定了选型权重

Data Flywheel 已有一套业务控制面：图像与视频接入、算子插件、工作流版本、候选数据集、标注审核、训练评测及问题回流。最近的影像 AutoGT 更强调源图、配方、Seed、参考类型、审核修订和数据划分的关联，详见[影像画质 Auto GT 方案]({{< relref "/posts/data-flywheel/image-quality-auto-gt/index.md" >}})。

当前实现与选型的关系如下，代码定位见[附录](#code-evidence)。

| 已有实现 | 对选型的影响 |
| --- | --- |
| React Flow 图编译为 Dagster op/job，依赖文件固定 Dagster 1.13.21 | 迁移引擎要重做图编译、提交、事件和恢复适配，不能只比较 SDK 写法 |
| 事务派发表、未知提交对账、取消围栏、节点租约 | 已有可靠性约束需要保留；更换引擎不会自动替代它们 |
| 当前编译出的 job 使用 `in_process_executor` | 同一 run 内默认串行；这不是 Dagster 并行能力的上限 |
| 本地及生产默认配置使用 `DefaultRunLauncher`；另有自定义 Docker launcher | Docker 路径已存在，不能把它写成从零建设；目标 GPU 环境仍需单独验收 |
| 运行中记录 `AssetMaterialization`，主要定义仍是 jobs 与 sensors | 已有产物事件，但还不能视为完整的软件定义资产图 |
| AutoGT 和比较任务由独立持久 Worker 执行 | 需要统一运行关联与产物协议，不必一次重写所有 Worker |

最影响决策的三项要求是：**数据版本与质量是否容易表达、能否沿用已有控制面、计算能否逐步扩展**。当前没有可支撑精确容量选型的生产负载数据，因此下文不使用未经实测的吞吐排名。

## 3 十个框架放在一张表里

“本平台判断”针对现在的 Data Flywheel；如果组织已有统一基础设施，结果可能不同。

| 框架 | 核心抽象与优势 | 主要适用场景 | 本平台判断 |
| --- | --- | --- | --- |
| [Dagster](https://dagster.io/docs/guides/build/assets) | Assets、ops/jobs、分区与检查；围绕数据产物组织依赖 | 数据产品、增量加工、质量与血缘 | **主方案**，补足资产语义和执行部署 |
| [Apache Airflow](https://airflow.apache.org/docs/apache-airflow/3.3.2/index.html) | Python DAG、调度、回填、Providers；支持资产驱动 | 跨系统批处理、企业数据工程 | 强候选；已有 Airflow 组织更值得优先考虑 |
| [Argo Workflows](https://argo-workflows.readthedocs.io/en/latest/) | Kubernetes Workflow CRD、DAG、容器及制品 | 容器批处理、多语言任务、集群流水线 | K8s 任务主导时的候选，暂不新增整套引擎 |
| [Prefect](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/get-started/index.mdx) | Python flows/tasks、动态控制流、状态与部署 | 从 Python 脚本演进到可运维流程 | 从零搭轻量 Python 平台时很有竞争力 |
| [Flyte](https://www.union.ai/docs/v2/flyte/user-guide/get-started/) | 类型化任务、执行环境、缓存与持久执行 | 计算密集的数据与 ML 工作流 | GPU/ML 计算成为绝对中心时重新比较 |
| [Temporal](https://docs.temporal.io/workflow-definition) | Workflow、Activity、历史重放及消息 | 跨服务、长等待、失败补偿的业务流程 | 复杂审核流程的潜在扩展，不作为当前数据主编排 |
| [Kubeflow Pipelines](https://www.kubeflow.org/docs/components/pipelines/overview/) | ML 组件、实验、运行、制品与 Kubernetes 后端 | 已有 Kubeflow 的训练与评测体系 | 可接入训练侧，当前全面迁入收益不足 |
| [Kestra](https://kestra.io/docs/why-kestra) | YAML flows、事件与多语言插件 | 团队共享自动化、声明式跨系统编排 | 若愿意采用它的产品与商业治理体系，可入围 |
| [Apache DolphinScheduler](https://github.com/apache/dolphinscheduler/blob/dev/README.md) | 可视化 DAG、任务插件、回填与项目权限 | 任务运维、SQL/Spark 等混合数据作业 | 适合直接采用现成调度工作台的团队 |
| [Metaflow](https://docs.metaflow.org/) | Python Flow、步骤产物与研发体验 | 数据科学家从本地实验走向生产 | 适合算法团队入口；可与底层编排器组合 |

这十个项目并不全部互斥。[Metaflow 可以把流程部署到 Argo Workflows](https://docs.metaflow.org/production/scheduling-metaflow-flows/scheduling-with-argo-workflows)，保留自己的产物访问与开发体验。也因此，选型要明确选的是开发 SDK、数据编排器，还是计算基础设施。

## 4 重点比较 Dagster Airflow 和 Argo

### 4.1 Dagster 与平台的数据交付方式最贴近

Dagster 的 Asset 表示持久化的数据对象及其生成方式，既可以是表，也可以是文件、模型。对影像平台，可以把“规范化源图集合”“候选配对清单”“质量报告”“已发布数据集”作为稳定的数据产物来组织依赖。[Assets](https://dagster.io/docs/guides/build/assets)

优势在于把**产物、生成逻辑和运行历史**放在同一张依赖图中，再按分区补齐或重算。分区可以按日期、批次或其他业务维度组织；具体粒度需要兼顾恢复成本与调度开销。[分区定义](https://dagster.io/docs/guides/build/partitions-and-backfills/partitioning-assets) · [回填](https://dagster.io/docs/guides/build/partitions-and-backfills/backfilling-data)

但接入 Dagster 并不会自动获得完整数据治理：

| 需要避免的误解 | 在本平台应怎样处理 |
| --- | --- |
| 有 materialization 事件就有完整资产依赖 | 逐步定义稳定 AssetKey、上游关系和业务版本映射 |
| `code_version` 就是文件内容摘要 | 分开保存代码版本、模型 revision、参数、输入与输出摘要 |
| Asset check 失败一定阻断发布 | 默认检查失败可继续执行下游；明确配置阻断，并保留平台发布门禁 |
| 引入资产就要把所有节点改成 `@asset` | 可复用的业务产物建模为资产，内部转换继续使用 op/job |

Dagster 的数据版本可以由代码版本及上游版本推导，也允许用户指定；随机生成和外部状态仍需显式建模。[版本与缓存](https://dagster.io/docs/guides/build/assets/asset-versioning-and-caching)

资产检查默认并不阻断下游，需配置 `blocking=True` 等相应行为。核验时官方文档还将专门的 **partitioned asset checks** 标为 Preview；当前方案不应依赖该预览接口承担唯一发布判定。分区及版本对应的检查证据先由平台持久化。[资产检查](https://dagster.io/docs/guides/test/asset-checks)

### 4.2 Airflow 仍然是强候选

Airflow 的优势是批工作流调度、任务运行管理和广泛的系统集成。对于“多个数据库抽取 → Spark 处理 → 仓库更新 → 下游通知”，尤其当公司已有 Airflow 运维、Provider 和发布流程时，继续使用通常比另建底座更经济。[Airflow 概述](https://airflow.apache.org/docs/apache-airflow/3.3.2/index.html)

**不能再把 Airflow 概括为只有 Cron 的静态 DAG。** 核验时的 3.3.2 文档包含资产驱动调度、资产分区和分区映射；Dynamic Task Mapping 可以依据运行时数据展开任务。[资产定义及分区](https://airflow.apache.org/docs/apache-airflow/3.3.2/authoring-and-scheduling/assets.html) · [动态任务映射](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/dynamic-task-mapping.html)

对当前平台，关键问题是迁移能换来什么：

| 若改为 Airflow | 收益与代价 |
| --- | --- |
| 复用组织已有调度平台 | 可以共享运维、告警和连接器；这是充分理由 |
| 自定义 React Flow 前端继续保留 | 仍需实现平台图到 Airflow 的映射和发布机制 |
| 影像配方、审核修订、来源隔离 | 这些业务语义仍由平台实现 |
| 现有 Dagster 执行链迁移 | 需要重验未知提交、取消、重试、缓存及产物提交 |

因此，Airflow 在通用数据工程中依然很有竞争力；在这个已有 Dagster 集成、强调影像数据版本的平台上，暂时缺少足以抵消迁移成本的收益。

### 4.3 Argo Workflows 适合容器任务成为基本单位的环境

Argo Workflows 以 Kubernetes CRD 描述工作流，可以用 DAG 或步骤关系组织容器任务，配合参数、制品仓库、重试、并发限制和模板复用。[官方概述](https://argo-workflows.readthedocs.io/en/latest/)

例如一条链包含 Python 解码、C++ 图像处理、CUDA 推理和独立评测镜像，各阶段都已有成熟容器交付，Argo 的抽象会很直接。它也提供[制品传递](https://argo-workflows.readthedocs.io/en/latest/walk-through/artifacts/)和[步骤缓存](https://argo-workflows.readthedocs.io/en/latest/memoization/)，不能简单说它“只会启动 Pod”。

平台仍需负责图像配对的参考类型、数据集版本、审核证据和发布条件。Argo 的 artifact 是工作流制品，memoization 是结果复用机制；二者不会自动成为影像数据资产目录与治理系统。

更关键的是，**使用 Kubernetes 并不要求同时引入 Argo**。Dagster 已有 Kubernetes run launcher 和步骤执行器：

| Dagster 部署选择 | 执行粒度 | 适用判断 |
| --- | --- | --- |
| `K8sRunLauncher` 配合进程内执行器 | 一个 run 启动一个 Kubernetes Job，步骤在其中执行 | 资源相近、步骤较短，希望降低频繁启动成本 |
| `k8s_job_executor` | 各步骤使用独立 Pod 执行 | 节点需要不同资源和隔离，需要接受更多启动开销 |
| 受控提交外部计算作业 | 一个步骤管理外部作业的生命周期 | 分布式训练、长驻服务或专门计算系统 |

前两项是 Dagster 官方能力，第三项是平台适配方案。节点资源配置只有在对应执行器支持时才生效，写入 GPU 标签本身不会分配 GPU。[Kubernetes 配置与执行粒度](https://dagster.io/docs/deployment/oss/deployment-options/kubernetes/customizing-your-deployment)

## 5 哪些替代方案值得认真保留

### 5.1 Prefect 适合优先改善 Python 开发体验

Prefect 用 flows/tasks 包装 Python 逻辑，支持动态控制流、状态跟踪、事件触发和人工介入。Work pool 连接编排服务与执行基础设施，可使用进程、Docker、Kubernetes 等方式运行。[Prefect 介绍](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/get-started/index.mdx) · [Work pools](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/work-pools.mdx)

如果从零开始，目标是把一批 Python 脚本尽快变成可靠的后台流程，Prefect 值得与 Dagster 并列试验。对当前平台，选择它仍需迁移现有适配层，而资产目录、业务版本和发布质量控制不会因此自动消失。

缓存也需要配置：[Prefect 文档](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/caching.mdx)明确说明缓存依赖结果持久化，默认缓存策略包含当前 flow run ID。要跨运行复用，需要设计相应策略与共享结果存储，不能仅添加装饰器就假定全局去重成立。

### 5.2 Flyte 是计算密集型 AI 平台的重要候选

Flyte 的执行环境、任务类型、资源声明、持久输出和缓存机制，适合昂贵的预处理、推理与训练。应特别注意版本语境：当前文档已经覆盖 **Flyte 2**，使用 Python 控制流、`TaskEnvironment` 和任务调用；不能把 Flyte 1 的静态工作流印象直接套用到新版本。[Flyte 2 入门](https://www.union.ai/docs/v2/flyte/user-guide/get-started/)

如果平台未来的主要复杂度变为多 GPU、大规模动态计算和算法任务复用，Flyte 应进入实际 PoC。选型时锁定 SDK、后端及部署版本，并区分 Flyte OSS 与 Union 的商业服务。

Flyte 2 的缓存键包含输入、任务名、输入输出接口及缓存版本，且默认关闭缓存。[缓存机制](https://www.union.ai/docs/v2/flyte/user-guide/tasks/task-configuration/caching/) 对画质任务，模型权重、Seed、依赖版本和源文件变化也必须进入输入或显式版本契约。框架的可复现执行机制无法替代非确定性 GPU 算子、外部 API 和生成模型自身的控制。

### 5.3 Temporal 解决长业务流程的恢复

“生成候选 → 等待审核 → 退回修订 → 再次审核 → 发布”可能持续数天。Temporal 将流程历史持久化，通过重放恢复 Workflow；外部 I/O 放在 Activities 中，业务事件通过 Signals 或 Updates 进入。[Workflow 定义](https://docs.temporal.io/workflow-definition) · [消息机制](https://docs.temporal.io/encyclopedia/workflow-message-passing)

这非常适合跨服务等待、超时升级、补偿和复杂分支。但 Workflow 代码有确定性要求，升级还要考虑旧流程的重放兼容；Activity 可能重试，仍要保证外部副作用的幂等。[Activities](https://docs.temporal.io/activities)

当前人工审核可以先使用平台已有的持久状态：计算结束后释放 Worker，审核提交后通过事件创建后续运行。只有当跨服务业务流程复杂到明显难以维护时，再引入 Temporal，并让它负责业务流程、Dagster 负责数据加工。

### 5.4 其余四个框架的机会与代价

| 框架 | 值得选择的条件 | 对本平台需要承担的代价 |
| --- | --- | --- |
| Kubeflow Pipelines | 已有 Kubernetes ML 平台，训练实验与组件复用是中心 | 需要对接它的组件、运行及制品模型；它可以独立安装，不必部署完整 Kubeflow |
| Kestra | 希望采用 YAML、现成 UI 和跨语言插件统一自动化 | 当前已经自建产品 UI；还要评估企业治理能力的商业边界 |
| DolphinScheduler | 希望直接采用可视化任务工作台，数据任务类型多 | 与现有画布、权限、插件目录存在产品职责重叠 |
| Metaflow | 算法团队希望从本地实验平滑进入生产 | 更适合作为研发入口，仍需选择和运维底层生产编排设施 |

以上分别依据 [KFP 概述与独立安装](https://www.kubeflow.org/docs/components/pipelines/overview/)、[Kestra 机制](https://kestra.io/docs/why-kestra)、[DolphinScheduler 官方说明](https://github.com/apache/dolphinscheduler/blob/dev/README.md)、[Metaflow 的 Argo 部署](https://docs.metaflow.org/production/scheduling-metaflow-flows/scheduling-with-argo-workflows)。最后一列是结合现有产品的取舍。

<details>
<summary>开源自托管与商业功能怎样影响成本</summary>

开源许可证成本只是总成本的一部分。还要计算控制面常驻服务、元数据数据库、日志存储、运行启动开销、运维值守、升级和适配开发。

| 方案 | 需要明确的边界 |
| --- | --- |
| Dagster OSS | 自托管 webserver、daemon、code location 和存储；Dagster+ 的管理功能单独评估 |
| Prefect 自托管 | 支持自建 Worker 的多种执行环境；Push 与 Managed 等工作池不能统一当成自托管能力 |
| Flyte OSS | 本地开发与生产后端是不同部署范围；不能将 Union 套餐能力直接归给 OSS |
| Kestra OSS | 官方将细粒度 RBAC、SSO、多租户及部分执行隔离能力归入 Enterprise；不能按完整企业版估算免费部署 |
| Argo / KFP | 可以复用现有 Kubernetes；如果需要为它们新建集群，集群运维也是选型成本 |

来源：[Dagster OSS 架构](https://dagster.io/docs/deployment/oss/oss-deployment-architecture)、[Prefect 工作池版本对照](https://github.com/PrefectHQ/prefect/blob/main/docs/v3/concepts/work-pools.mdx)、[Flyte OSS 文档](https://www.union.ai/docs/v2/flyte/user-guide/get-started/)、[Kestra OSS 与 Enterprise 对照](https://kestra.io/docs/oss-vs-paid)。

尤其要注意 Dagster OSS 文档列出的服务副本限制：daemon 不支持多副本，每个 code location server 也不是随意水平扩容。多机执行能力不等于控制面已经满足目标高可用要求，上线时要验证故障恢复与维护窗口。

</details>

## 6 推荐架构与明确分工

**推荐组合：React Flow + FastAPI + Dagster OSS + Python SDK + PostgreSQL + 制品存储。** 本地继续采用受控进程或现有 Docker 路径；远端计算按负载接入 Docker/Kubernetes，训练和批量推理可以通过受控作业适配器执行。

{{< mermaid >}}
flowchart TD
    UI["React Flow<br/>业务工作台"] --> API["FastAPI<br/>权限与业务控制"]
    API --> DB[("业务库<br/>版本 审核 运行意图")]
    DB --> ADAPTER[派发与对账]
    ADAPTER --> DG["Dagster<br/>依赖与运行管理"]
    ADAPTER --> AW["AutoGT Worker<br/>已有持久执行路径"]
    DG --> CPU["本地进程<br/>Docker"]
    DG -. 按需扩展 .-> K8S["Kubernetes<br/>外部计算作业"]
    CPU --> ART[("统一产物与事件<br/>清单 摘要 检查结果")]
    K8S --> ART
    AW --> ART
    ART --> GATE["平台发布门禁<br/>质量与人工审核"]
    GATE --> VERSION[不可变数据集版本]
{{< /mermaid >}}

虚线表示后续扩展。已有 AutoGT Worker 先保留，通过关联 ID 和统一产物契约纳入运行视图；只有当依赖编排确实变复杂时，再决定接入 Dagster 的具体方式。

| 责任 | 权威来源 | 其他组件怎样使用 |
| --- | --- | --- |
| 用户权限、审核、数据集发布 | 平台业务库 | 编排器只能调用经过授权与门禁校验的接口 |
| 工作流依赖、步骤状态 | 该次运行选定的执行引擎 | 平台保存可重建的状态投影和引擎运行 ID |
| 输入、代码、模型和环境版本 | 不可变执行快照 | 提交及执行时核验，不读取随时变化的 latest |
| 文件内容与完整性 | 制品存储及摘要清单 | 数据库保存引用，发布时核验完整产物 |
| GPU 分配与节点容量 | 执行基础设施 | 平台做准入控制，执行层实际落实资源约束 |

平台的取消围栏和发布状态仍有独立意义：引擎可能报告任务技术成功，但平台已经取消或审核被撤回，此时不能发布。对账要保留两种事实，并拒绝迟到结果覆盖业务决定。

### 6.1 数据产物建模为资产 内部计算保留任务图

建议先选择一条稳定 AutoGT 链作为资产化试点：

{{< mermaid >}}
flowchart TD
    S[冻结源图清单] --> P[候选配对清单]
    R[配方 模型 Seed 版本] --> P
    P --> Q[质量报告]
    Q --> H[人工审核状态]
    H -->|通过后创建后续运行| D[已发布数据集版本]
    H -->|拒绝后建立修订| R2[新配方与新运行]
    R2 --> P
    D --> E[训练与评测报告]
{{< /mermaid >}}

这是跨多次运行的数据与业务关系图。拒绝后的回流产生新版本，不把反馈环直接塞进单次 DAG。

映射时遵循以下约束：

- **资产键表示稳定的业务产物类别**，如某项目的候选配对集合；批次、配方修订、具体制品 ID 另行记录。
- **分区按有界批次或来源组设计**。单张图的细节留在 manifest 中，避免每张图都成为独立资产。Dagster 官方建议每个资产的分区数控制在 100,000 以内，以免影响 UI 加载；实际还应测量目标规模。[分区说明](https://dagster.io/docs/guides/build/partitions-and-backfills/partitioning-assets)
- **业务版本必须不可变**。重算同一逻辑分区应生成新制品，历史数据集仍指向旧制品摘要；不能只引用“该分区最新结果”。
- **内部多步骤继续用 op/job 或 graph-backed asset**。是否成为资产，取决于产物是否需要独立追踪和复用，不取决于画布上是否存在节点。[Graph-backed assets](https://dagster.io/docs/guides/build/assets/graph-backed-assets)

### 6.2 重试 缓存与发布分别设计

| 机制 | 回答的问题 | 必须具备的约束 |
| --- | --- | --- |
| 重试 | 上次没完成，能否再执行 | 暂态错误分类、次数上限、幂等副作用或对账 |
| 缓存 | 以前的结果是否可以复用 | 项目范围、输入摘要、代码、模型、参数与环境指纹 |
| 检查点 | 大任务失败后从哪里继续 | 已提交分片清单、摘要、租约及一致的输入版本 |
| 发布 | 结果是否可以成为正式数据版本 | 文件完整、质量达标、审核有效、来源组划分合法 |

建议的缓存身份由以下信息规范化后求摘要：

```text
项目与访问范围
+ 输入清单摘要
+ 算子发布摘要与协议版本
+ 模型及配方版本
+ 参数与随机种子
+ 会影响结果的运行环境
```

缓存命中后仍要核验文件可用性与访问权限。随机生成任务可以选择复用已保存的某次输出，但相同 Seed 本身不保证跨硬件逐像素一致。外部发布、通知、付费 API 等副作用采用各自的幂等键和确认记录。

### 6.3 避免形成两套调度事实

若以后确实需要 Dagster 调用 Argo，应把 Argo 子工作流作为边界清晰的外部作业：固定输入、模板版本与外部 ID，提供提交、查询、取消和结果清单。Argo 管理子工作流内部重试，Dagster 在边界上做有界恢复；网络超时后先查询已提交任务。

不要让两个引擎同时对同一组节点各自重试、各自判断发布。取消也必须传播到子作业，并由平台围栏阻止迟到产物发布。单独调用 Kubernetes Job 已能满足需求时，就不增加 Argo 控制面。

## 7 从现状演进的实施顺序

| 阶段 | 具体交付 | 完成条件 |
| --- | --- | --- |
| 第一阶段 统一执行契约 | 汇总 Pipeline 与 AutoGT 的运行 ID、快照、分片、制品和检查证据；展示未知提交与取消状态 | 用户能从数据版本追到输入与执行依据，重复请求不产生重复业务提交 |
| 第二阶段 一条资产化链 | 将源清单、候选配对、质量报告和发布数据集映射为资产；固定分区与版本规则 | 修改一批输入后，只重算必要范围，旧数据版本仍可读取 |
| 第三阶段 验证 Docker 生产路径 | 沿用现有 launcher，完成真实镜像、存储、网络及 CPU/GPU 目标验收 | 运行、查询、取消、重启恢复和资源约束均在目标环境通过 |
| 第四阶段 按负载进入 Kubernetes | 先试 run 级 Job，再比较步骤级 Pod 或外部作业 | 吞吐、排队和单位成本相对基线有可复测收益 |
| 条件阶段 引入专门编排器 | 容器任务选 Argo，复杂业务流程选 Temporal，ML 计算重评 Flyte/KFP | 新框架解决了明确瓶颈，并通过跨引擎恢复验收 |

现有平台同时有 interval/data 触发和 Dagster 执行队列。每个 deployment 应明确由谁生成运行意图；若将触发迁入 Dagster schedules/sensors，要先关闭原触发所有者，继续复用幂等事件身份。两个组件都定时触发同一流程，会制造重复运行。

当前 Docker launcher 还引用了 Dagster 的私有模块与扩展方法。升级应同步固定并验证核心包和集成包，覆盖 launch、查询、取消与 resume，不能直接追随最新版本滚动升级。

迁移期间按流程版本固定执行后端。已开始的运行留在旧后端完成，新版本再切换；统一制品协议让后端可以替换。新旧方案需要对照时，优先使用无副作用的验证数据，正式发布仍保留唯一入口。

## 8 用同一条真实链路完成 PoC

比较框架最有效的办法，是让它们面对同一组故障与交付要求。建议以“图像归一化 → 配方生成 → 质量检查 → 人工审核 → 正式数据集”为测试链，输入固定为实际有权使用的样本和不可变 manifest。

先在当前 Dagster 上测量，再只实现最有可能改变结论的对照方案：偏 Kubernetes 比 Argo，偏动态 ML 计算比 Flyte，偏 Python 开发效率比 Prefect。无需为了完整榜单维护十套 PoC。

| 验收项 | 操作 | 通过标准 |
| --- | --- | --- |
| 提交不确定 | 后端接受任务后丢失响应 | 以稳定身份查回原任务，不盲目创建替代运行 |
| 计算中断 | 杀掉 Worker，重启执行服务 | 从合法检查点恢复；旧租约写入被拒绝 |
| 取消竞争 | 取消时仍有任务写出结果 | 后续结果不能成为正式发布版本 |
| 增量重算 | 只改一批输入或一个配方版本 | 必要范围重算；未受影响产物可以解释为何复用 |
| 质量门禁 | 注入损坏图像或来源组冲突 | 计算成功也无法绕过质量与划分规则发布 |
| 人工等待 | 审核暂停一段时间 | GPU 和计算 Worker 释放；重启后审核仍可继续 |
| 资源隔离 | CPU/GPU 作业混合排队，超配额提交 | 请求进入正确资源池，资源上限真实生效 |
| 版本升级 | 新旧插件或执行器版本并存 | 旧运行仍可定位和恢复，新运行使用冻结版本 |

性能记录至少分为：**排队、镜像与模型初始化、实际处理、产物写入**。同时测端到端耗时、样本吞吐、峰值内存/显存、失败后的重算量、调度事件数量和元数据增长。GPU 成本按实际占用时间核算，别把工作流耗时直接当成有效计算时间。

开始前由业务目标确定可接受的等待时间、恢复时间与成本上限。它们决定是否进入下一阶段；框架文档中的性能宣传不能替代这一基线。

## 9 什么变化会改变推荐

| 未来条件 | 重新优先评估 |
| --- | --- |
| 公司已有成熟 Airflow 平台，大多数任务依赖其连接器和运维流程 | Airflow |
| 工作负载主要是独立容器，已有成熟 Kubernetes 团队 | Argo Workflows |
| 从零起步，主要想快速管理动态 Python 脚本 | Prefect |
| 大规模类型化 AI 任务、GPU 资源与执行复用成为核心难题 | Flyte |
| 已有 Kubeflow，训练实验和 ML 组件占主要投入 | Kubeflow Pipelines |
| 跨服务审批、补偿、计时与长流程恢复成为主要复杂度 | Temporal 负责业务流程 |
| 希望直接使用现成可视化调度产品，减少自建工作台 | DolphinScheduler 或 Kestra |

当前更值得投入的，是让 Dagster 已有执行能力与平台的数据资产、版本和质量交付连起来。第一项可执行工作应是：**选一条 AutoGT 链，完成资产映射及故障注入验收，再决定是否扩展执行基础设施。**

## 附录 代码依据与延伸阅读 {#code-evidence}

<details>
<summary>展开本次核对的项目文件与实现边界</summary>

以下路径相对 `data-flywheel` 仓库，代表 2026-10-28 本地工作区快照。

| 文件 | 核对内容 |
| --- | --- |
| `apps/api/requirements-dagster.txt` | Dagster 固定 1.13.21，集成包按配套版本固定 |
| `apps/api/app/media_dagster.py` | `compile_job` 将平台图变为 op/job；使用进程内执行器；记录产物事件；Definitions 主要加载 jobs/sensors |
| `apps/api/app/dispatch_worker.py` | 事务派发、租约、未知提交对账，禁止盲目重提 |
| `docs/runtime-production-execution.md` | 执行快照、项目与资源池准入、interval/data 触发及回填语义 |
| `infra/dagster/dagster.local.yaml` 与 `dagster.production.yaml` | 默认 launcher、运行队列及 SQLite/PostgreSQL 存储配置 |
| `infra/dagster/dagster.docker.yaml` 与 `apps/api/app/docker_run_launcher.py` | 固定镜像摘要、Docker 目标路由、CPU/内存/网络及 GPU 参数 |
| `apps/api/app/worker_registry.py` 与 `docs/runtime-governance.md` | 本地 Dagster 与白名单 Docker 目标；远端 Agent 协议未实现；现有记录未完成远端 GPU 验收 |
| `apps/api/app/auto_gt_worker.py` 与 `docs/image-auto-gt.md` | AutoGT 独立 Worker、版本冻结、租约围栏、审核和发布规则 |

Docker 适配代码已经存在；历史验证记录中的两个逻辑 Docker 目标均指向本机 daemon，不能据此声称远端 GPU 与完整生产镜像已经验证。本文也未将这些历史记录当成此次重新运行的结果。

</details>

相关平台文章：

- [流水线与算子插件设计评审]({{< relref "/posts/data-flywheel/pipeline-plugin-design-review/index.md" >}})
- [流水线编排与算子插件需求文档草案]({{< relref "/posts/data-flywheel/pipeline-operator-requirements/index.md" >}})
- [Data Flywheel 的 Kubernetes 架构]({{< relref "/posts/ai-data/data-platform/kubernetes/index.md" >}})
- [影像画质 Auto GT 生成方案与数据平台设计]({{< relref "/posts/data-flywheel/image-quality-auto-gt/index.md" >}})
