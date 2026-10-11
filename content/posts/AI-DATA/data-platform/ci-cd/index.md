+++
date = '2026-09-06T00:07:00+08:00'
draft = false
title = '数据平台 CI/CD 技术方案：从代码提交到服务、算子与数据发布'
description = '面向 React、FastAPI 与数据算子的数据平台 CI/CD 方案，涵盖流水线分层、质量门禁、不可变制品、环境晋级、迁移、灰度和数据恢复。'
categories = ['数据平台']
tags = ['数据平台', 'CI/CD', 'DevOps', 'GitHub Actions', '数据质量', '持续交付']
featured = false
+++

一次视频切分算子升级，可能通过全部接口测试、正常完成部署，却把片段边界整体偏移一秒。服务没有报错，后续标签、向量与训练样本却已经受到影响。这是数据平台建设 CI/CD 时必须面对的问题：**代码能够运行、系统能够升级、输出数据能够被使用，是三个不同的验收结论。**

本文承接 [发布流程与环境管理]({{< relref "/posts/ai-data/data-platform/release-environments/index.md" >}})，把环境和发布原则细化为流水线、制品、测试与恢复协议。以系列文章中的 React + TypeScript + Vite、FastAPI 和独立 Worker 为背景；以下目录、脚本与发布协议均为建议设计，不代表 Data Flywheel 已经实现。工具文档核对日期为 2026-09-06。

<!--more-->

## 1. 先定义 CI/CD 要交付什么

CI（Continuous Integration，持续集成）回答“这次变更是否可以与主干集成”；持续交付回答“经过验证的版本是否随时具备发布条件”；持续部署进一步将满足条件的变更自动部署到生产。本文选择**自动集成与验证、受控生产晋级**，高风险变更保留人工决策。

数据平台建议拆成两条相互关联的交付链路：

| 链路 | 交付对象 | 完成条件 |
| --- | --- | --- |
| 软件交付 | 前端、API、Worker、算子包、迁移与配置 | 目标环境运行指定版本，兼容性与运行指标达标 |
| 数据交付 | 数据集快照、派生标签、Embedding、索引 | 输入与处理过程可追溯，质量达标，显式发布后下游可见 |

CI/CD 系统负责验证、打包、触发与记录。持续数小时的重算交给数据平台的任务系统，流水线保存任务 ID，并等待或订阅结果；不把 CI Runner 当成长期 GPU 调度器。软件发布成功，也不应自动将该版本生成的所有数据标记为可信。

## 2. 总体架构与工具边界

可以从 GitHub Actions + OCI 镜像仓库 + 版本化部署配置起步。企业已有 Jenkins 或 GitLab CI 时，可以沿用现有平台，复用下面的阶段和脚本契约。部署目标可以先是 Compose；已有集群和运维能力时，再接 Kubernetes。GitOps 控制器也应在多环境管理、漂移检测等需求明确后引入。

{{< mermaid >}}
flowchart TD
    A[PR 与变更影响分析] --> B[静态检查与分层测试]
    B --> C[主干提交验证并构建制品]
    C --> D[制品仓库与不可变发布清单]
    D --> E[Staging 部署和端到端回归]
    E --> F[生产发布门禁]
    F --> G[服务灰度与新任务路由]
    G --> H[平台调度器运行小批数据任务]
    H --> I[候选输出与质量报告]
    I --> J{质量与运行指标达标}
    J -->|通过| K[晋级服务并发布数据版本]
    J -->|失败| L[停止扩量与隔离输出]
    L --> M[恢复兼容版本或前向修复]
{{< /mermaid >}}

建议将职责分开：

- **CI Runner**：执行测试和构建，只访问对应阶段需要的资源。
- **制品仓库**：保存镜像、包、校验和、依赖清单与来源记录。
- **部署执行器**：将已验证制品与目标环境配置组合，执行迁移和部署。
- **平台调度器与 Worker**：接收固定版本的任务，管理重试、检查点与计算资源。
- **发布与质量记录**：关联 Commit、Release、Run、数据版本与验证证据。

同一环境应有一个明确的部署入口。若采用 GitOps，流水线修改期望状态，由控制器部署；不要再让另一路脚本直接修改同一组资源，制造相互覆盖。

## 3. 仓库组织：让本地与 CI 使用同一入口

下面是建议目录，不是当前博客仓库的结构：

```text
data-platform/
├── apps/web/                 # React 前端及依赖锁文件
├── apps/api/                 # FastAPI、单测与锁定依赖
├── workers/                  # CPU/GPU 执行环境
├── operators/                # 算子实现、契约与测试
├── contracts/                # API、任务消息与数据 Schema
├── migrations/               # 数据库迁移
├── tests/fixtures/            # 小型合成样本与预期结果
├── tests/integration/         # 数据库、队列、存储集成测试
├── tests/e2e/                 # 用户流程回归
├── deploy/                   # 部署模板与环境非敏感配置
├── ci/                       # 可在本地执行的检查和发布脚本
└── .github/workflows/        # 触发、依赖、权限与制品传递
```

工作流 YAML 负责组织阶段，业务检查放进可独立运行的脚本。例如 `ci/check-web.sh`、`ci/check-api.sh` 和 `ci/check-operator.sh`。脚本应在失败时返回非零退出码，输出可保存的报告；不能用 `|| true` 把关键失败转成绿色。

前后端依赖、基础镜像和模型修订需要锁定，缓存键包含运行时、平台与锁文件摘要。缓存只是加速手段，缓存丢失后仍应能重新构建。前端若要使用同一制品跨环境晋级，可以统一使用相对路径 `/api`，或启动时加载版本化公开配置；构建时写死 Staging 域名会破坏这一约定。浏览器可见配置中不能放凭据。

## 4. 流水线分成四层

| 流水线 | 触发条件 | 核心动作 | 产出与阻断条件 |
| --- | --- | --- | --- |
| PR CI | PR 创建与更新 | 检查、单测、契约、受影响组件集成测试 | 关联候选提交的报告；失败不得合并 |
| Main Build | 受保护主干合并 | 验证实际合并提交，构建、扫描、推送制品 | 固定 Digest 与候选发布清单；不因 PR 曾通过而跳过必要验证 |
| Release CD | 选择候选 Release | Staging 回归、迁移演练、生产门禁、灰度 | 部署记录与数据质量报告；全部满足才可扩量 |
| Scheduled Validation | 定时或手动 | 大样本、GPU、性能、恢复和长任务测试 | 趋势与异常报告；关键缺口阻断相关候选版本晋级 |

目录级变更分析可以节省成本，但要包含依赖传播：修改共享契约、锁文件、基础镜像或迁移时，必须扩大测试范围。只改一个文件并不等于只影响一个服务。路径过滤跳过的任务，需要由统一汇总检查判断是否符合预期，不能把“没运行”视为“已通过”。

夜间 GPU 测试不能替代修改模型或算子后的候选版本验证。若发布依赖该报告，必须确认报告绑定当前制品和样本快照，并满足约定的有效期。

## 5. 数据平台应该测试什么

### 5.1 从代码正确性到业务闭环

| 层级 | 重点用例 | 应捕获的问题 |
| --- | --- | --- |
| 静态与单元测试 | 类型、参数校验、权限判定、时间区间 | 前端字段错误、边界条件、越权逻辑 |
| 契约测试 | OpenAPI、任务消息、算子输入输出 | 删除字段、改变单位、旧消费者无法解析 |
| 集成测试 | 目标 PostgreSQL、队列、对象存储、身份服务 | 事务行为差异、重复消费、签名或授权错误 |
| 端到端测试 | 登录 → 选项目 → 提交任务 → 查看结果 | 会话、项目隔离、状态同步与结果展示断裂 |
| 数据回归 | 切分、标签、Embedding 与检索 | 服务成功但数据语义或检索效果退化 |
| 恢复测试 | 执行中退出、重试、回滚与恢复备份 | 重复写入、半成品可见、恢复步骤不可执行 |

SQLite 上通过的测试不能替代目标 PostgreSQL 上的迁移和事务验证。权限测试同时覆盖允许与拒绝：用户能访问自己项目的数据，也必须无法通过直接调用 API 读取其他项目的资产。

### 5.2 固定数据回归集

建议维护三种样本：PR 使用小型合成与边界样本；Staging 使用代表性、已授权的脱敏样本；定时任务使用更大规模的数据评估性能和资源成本。

每个样本集都记录清单摘要、资产版本、标签版本和预期结果。视频样本可覆盖可变帧率、无音轨、损坏输入、极短片段与空结果。对切分结果检查半开区间、边界合法性、覆盖和重叠策略；对向量检查维度、有限数值和模型修订；对检索使用固定查询和相关性标签评估 Recall@K。

以下是**示例门禁**，用于说明怎样把要求变成可判定条件，数值需要按业务基线校准：

| 检查 | 示例规则 | 失败后处理 |
| --- | --- | --- |
| Schema 与完整性 | 必填字段、主键唯一性、外键引用全部通过 | 阻断候选输出发布 |
| 幂等性 | 同一逻辑任务重试后只有一个已提交结果版本 | 阻断算子发布 |
| 检索效果 | 相同评测集 Recall@20 下降不超过 1 个百分点 | 复核分组结果与误差，未解释前阻断 |
| 性能与成本 | 同硬件同样本吞吐下降不超过 10% | 检查资源与成本预算 |
| 隔离与授权 | 跨项目读写拒绝用例全部通过 | 阻断服务发布 |

模型输出可能存在非确定性，不能一律要求逐字节相同。应固定可固定的输入、模型、参数与运行环境，明确容差，重复测量，并按场景分组观察；整体平均值可能掩盖夜间或雨天场景的退化。

## 6. 构建一次，用发布清单组织晋级

每个组件可以独立构建，但一次平台发布必须明确组合了哪些版本。镜像用 Digest 标识；可变 Tag 仅用于展示和检索。Kubernetes 官方说明 Digest 能固定具体镜像内容，避免标签漂移，参见 [Images](https://kubernetes.io/docs/concepts/containers/images/)。

下面是本文设计的候选清单，尖括号内容均为占位符：

```yaml
release_id: dp-20260906-01
source_commit: "<full-commit-sha>"
artifacts:
  web: "registry.example.com/web@sha256:<digest>"
  api: "registry.example.com/api@sha256:<digest>"
  worker: "registry.example.com/worker@sha256:<digest>"
pipeline_revision: scene-mining-12
operator_lock_digest: "sha256:<operator-lock-digest>"
model_revision: encoder-r17
schema_revision: clip-v3
migration_revision: db-208-expand
validation:
  fixture_manifest_digest: "sha256:<fixture-manifest-digest>"
  report_digest: "sha256:<report-digest>"
compatibility:
  task_message_read_versions: [2, 3]
  rollback_release: dp-20260905-02
```

部署时再生成环境记录：候选清单摘要、配置摘要、密钥引用、迁移执行结果、操作者、时间和灰度策略。环境配置或策略变化也要重新验证并留下记录；不能因为镜像没变就跳过检查。

Staging 与 Prod 拉取同一 Digest。若改变了编译参数或重新构建，就产生新的候选版本，重新验证。构建来源证明、签名和 SBOM 可以辅助检查制品来自哪个受信工作流、包含哪些依赖，但不能替代业务测试。生产入口应核对制品来源、验证报告和清单关联，拒绝没有验证证据的任意镜像。

## 7. GitHub Actions 如何表达生产门禁

GitHub Actions 提供 Environment 保护规则、部署分支限制与 Concurrency。**写上 `environment: production` 不等于已经配置审批**，还需要在仓库设置中配置规则并确认当前套餐与仓库可见性支持所需能力。参见 [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。

以下仅展示生产 Job 的关键配置，是嵌入 Release 工作流的**局部骨架，不能直接作为完整工作流运行**。假定前序 `verify_candidate` 与 `staging` 已完成制品来源验证和 Staging 回归；受信版本的发布脚本已由前置步骤准备好，部署认证已配置。

```yaml
jobs:
  production:
    needs: [verify_candidate, staging]
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: data-platform-production
      cancel-in-progress: false
    permissions:
      contents: read
      id-token: write
    timeout-minutes: 45
    steps:
      # 完整工作流还需固定版本的脚本、部署客户端和受限认证步骤。
      - name: Promote verified candidate
        env:
          RELEASE_MANIFEST_DIGEST: ${{ needs.verify_candidate.outputs.manifest_digest }}
        run: |
          set -euo pipefail
          ./ci/promote.sh \
            --manifest-digest "$RELEASE_MANIFEST_DIGEST" \
            --environment production
```

这里的 `ci/promote.sh` 是待实现接口，至少承担以下契约：校验摘要与验证状态；获取环境锁；检查当前版本和迁移前置条件；执行兼容迁移；部署并观察灰度；写入成功或失败记录。重复请求应读取已有操作状态，不得重复执行迁移或重新提交同一数据任务。

`cancel-in-progress: false` 避免新请求主动中断正在进行的生产 Job，但 Concurrency 不是可靠的先进先出发布队列，待执行请求可能被替换。不同工作流必须使用同一个并发组；跨仓库及人工入口还需共享部署锁和操作记录。参见 [GitHub Actions 部署控制](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。

超时、Runner 退出或手工取消，也不代表远端迁移或任务已经停止。发布执行器需要独立保存操作 ID、状态与锁租约，恢复后先对账，再决定继续或修复。不能将 CI 页面的红灯直接解释为生产已回到旧版本。

## 8. 数据库、Worker 与索引的发布顺序

### 8.1 数据库采用 Expand → Migrate → Contract

以时间字段升级为例：

1. 增加新字段，验证旧 API 和旧 Worker 在扩展后的 Schema 上仍可运行。
2. 发布兼容读写的新服务，明确双写时的权威字段和失败处理。
3. 由独立回填任务分批补齐历史数据，记录检查点，限制锁等待和资源占用。
4. 完成一致性校验，再切换读取并观察。
5. 等旧消费者退出、回滚窗口结束后，通过后续发布删除旧字段。

迁移由单一执行者运行，并记录版本与结果，不由每个 API 副本启动时同时执行。测试既包括空库初始化，也包括从当前生产 Schema 和代表性数据量升级。不能假定所有 DDL 都可事务回滚；长时间索引创建、锁表和中断恢复要在目标数据库演练。

### 8.2 Worker 按任务版本切流

API、消息生产者、消费者之间需要兼容窗口。可以先发布同时读取消息 v2/v3 的消费者，再开启生产者写 v3。旧 Worker 完成已领取任务后退出，新任务按版本路由到新 Worker；若镜像需要替换，先停止领取并排空，或在已验证的检查点安全中断。

任务记录绑定算子包、模型、参数和输入快照，不在重试时解析 `latest`。对 GPU Worker 还需验证驱动、运行时和模型加载组合，CPU 单测无法覆盖这部分。

### 8.3 索引与查询编码器成组切换

新模型产生新向量空间，应创建新索引，完成增量追平和固定检索集验证，再切换查询编码器与索引的组合。保留旧组合及恢复窗口。若引擎不支持原子别名切换，可由平台路由记录指定组合，并通过版本检查防止新编码器请求旧索引。

Kubernetes Deployment 的滚动更新和回滚围绕 Pod 模板进行，不会自动恢复外部数据库、对象存储或索引。参见 [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)。

## 9. 数据结果采用“候选写入—校验—发布”

推荐将 Run 状态和 Dataset Version 状态分开：计算执行成功后，结果仍可以处于待校验状态。一个最小协议是：

1. 冻结输入清单，创建逻辑 Run，并记录算子、模型、参数和目标分区。
2. 每次尝试写入独立候选路径，产出文件清单与校验和。
3. 对候选结果执行数量、Schema、重复率和业务质量检查。
4. 使用元数据事务或条件更新提交结果清单，并将数据版本标记为已发布。
5. 下游只读取已发布清单；失败候选保留诊断信息，按保留策略清理。

对象存储与数据库通常不共享事务，因此不能依赖“文件已上传”证明发布成功。先完成不可变对象和完整性检查，再原子更新元数据可见性；中断留下的孤立对象由对账清理。消费者不能绕过发布记录，直接扫描候选目录。

幂等键可由“租户／项目 + 输入快照 + 算子版本 + 参数摘要 + 目标分区”组成，尝试次数单独记录。还要用唯一约束或条件提交确保两个重试不能都发布；需要主动重算时，显式增加计算修订，避免被旧幂等键拦截。

Airflow 官方建议任务不要产生不完整结果，重试应保持一致，并使用明确的数据分区。这里借鉴的是任务语义，具体发布事务仍由平台实现，参见 [Airflow Best Practices](https://airflow.apache.org/docs/apache-airflow/stable/best-practices.html)。

## 10. 灰度发布与失败恢复

在线 API 可以按租户或请求灰度，数据处理建议按确定的项目、来源或分区选择小批任务。数据灰度要隔离候选输出，避免两个版本同时写同一正式分区。观察窗口同时规定时长和最小任务量；没有样本时不能自动认定通过。

| 故障 | 立即动作 | 恢复依据 |
| --- | --- | --- |
| API 错误率或延迟超限 | 停止扩量，回切兼容服务与配置 | 发布清单、Schema 兼容窗口 |
| Worker 持续失败或积压 | 暂停向新版本派单，排空或安全终止 | Run 状态、检查点、消息版本 |
| 数据质量下降 | 拒绝发布候选结果 | 输入快照、候选清单、质量报告 |
| 错误数据已被下游消费 | 标记受影响版本，暂停传播，生成修复任务 | Release → Run → 数据版本 → 消费者血缘 |
| 破坏性迁移已经执行 | 停止自动回切，评估前向修复或恢复备份 | 迁移记录、恢复点和业务数据窗口 |

例如切分算子偏移一秒，恢复旧 Worker 只解决后续计算。已经生成的标签和向量需要按血缘定位，隔离受影响数据版本，从原始快照重新处理并重新验证；不能把“部署回滚完成”写成“数据恢复完成”。

备份方案要定义 RPO（可接受的数据丢失窗口）与 RTO（可接受的恢复时间），并通过恢复演练验证。备份任务成功本身不能证明数据能在目标时间内恢复。

## 11. 凭据与流水线自身的边界

PR 检查与生产部署应分离身份。来自不受信分支的代码不能获得生产凭据，也不应运行在能访问生产网络的持久化 Runner 上；测试样本和外部回调需要隔离。第三方 Actions 固定到经过核验的完整 Commit SHA，工作流和发布脚本的修改也纳入评审。参见 [GitHub Actions Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)。

支持 OIDC 的目标服务可以让部署 Job 换取短期凭据，避免保存长期云密钥，但仍需限制受信仓库、工作流／环境等身份条件，并为角色授予最小权限。`id-token: write` 只允许请求 OIDC Token，不会自动获得云端部署权限。参见 [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect)。

生产审批应展示具体 Release、制品摘要、质量报告、迁移与恢复方案。审批后如果配置、清单或制品发生变化，应视为新的候选，重新验证相关部分。

## 12. 分阶段落地与验收

| 阶段 | 交付内容 | 可检查的验收结果 |
| --- | --- | --- |
| 第一阶段：集成可靠 | 锁定依赖、统一检查入口、PR 门禁、主干构建 | 从干净环境能构建；失败检查阻断合并；制品可追踪到提交 |
| 第二阶段：发布可控 | Staging 回归、固定制品晋级、受控生产入口 | Staging 与 Prod 制品摘要一致；重复发布不重复迁移 |
| 第三阶段：数据可信 | 固定样本、算子质量门禁、候选数据发布协议 | 有意制造的边界偏移被阻断；重试不重复发布结果 |
| 第四阶段：恢复可验证 | 任务血缘、兼容升级、灰度停止条件、恢复演练 | 能定位污染范围；中断后可对账；恢复达到约定 RPO/RTO |

持续记录 PR 反馈时长、排队时间、发布失败率、恢复耗时、质量阻断次数和单位样本计算成本。先用这些数据找出实际瓶颈，再优化缓存、并行度和样本分层；不要通过减少关键验证来制造更短的流水线时间。

这套方案与 [前后端技术框架选型]({{< relref "/posts/ai-data/data-platform/technology-stack/index.md" >}}) 的服务边界、[Operator as Plugin]({{< relref "/posts/ai-data/data-platform/operator-as-plugin/index.md" >}}) 的算子契约，以及 [权限管理]({{< relref "/posts/ai-data/data-platform/access-control/index.md" >}}) 的授权模型共同落地。每次交付都应能回答：运行了哪个版本、处理了哪些输入、通过了哪些验证，以及失败后如何恢复。
