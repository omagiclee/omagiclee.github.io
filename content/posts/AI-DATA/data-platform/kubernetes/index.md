+++
date = '2026-09-06T00:07:00+08:00'
draft = false
title = 'Data Flywheel 的 Kubernetes 架构：从服务部署到 CPU/GPU 数据流水线'
description = '结合 Data Flywheel 当前代码，讨论 Kubernetes 的引入时机、控制与计算分离、GPU Job、任务幂等、存储隔离、扩缩容与上线验证。'
categories = ['数据平台']
tags = ['数据平台', 'Data Flywheel', 'Kubernetes', 'K8s', 'GPU', '任务调度', '系统架构']
featured = false
+++

数据飞轮平台中的负载差异很大：需求列表查询希望在短时间内返回，视频切分可能运行数分钟，批量 Embedding 会占用 GPU，人工标注则可能等待数天。如果把它们都放进 FastAPI 进程，计算任务的内存峰值和故障就会直接影响用户工作台。

**Kubernetes（K8s）可以承担服务运行、资源分配和作业生命周期管理；数据平台仍需定义输入快照、算子契约、任务状态与结果发布规则。** 本文围绕 Data Flywheel，说明这两层如何衔接。

代码与官方资料核对日期为 2026-09-06。当前项目已有 React/Vite、FastAPI、Keycloak、业务权限与本地 PostgreSQL Compose 配置；本次查看的目录中未发现 K8s 清单或 Helm Chart。以下集群架构、执行适配器和 YAML 均为建设方案，不能视为已经完成的生产部署。

<!--more-->

## 1. 什么时候值得引入 Kubernetes

当前 Data Flywheel 的重点仍包括需求、事件和权限闭环。若计算任务只是少量脚本，单机容器加持久化任务记录也可以起步。引入 K8s 的收益应来自实际运行问题。

| 触发条件 | 希望获得的能力 | 同时增加的工作 |
| --- | --- | --- |
| CPU/GPU 任务跨多台机器运行 | 统一声明资源与选择节点 | 节点、驱动、网络和镜像维护 |
| 多个项目竞争计算资源 | 并发限制、排队和配额 | 队列策略、成本归属与容量规划 |
| API 与算法发布节奏不同 | 独立部署与扩缩容 | 契约兼容、日志关联和版本追踪 |
| 长作业经常因节点故障中断 | 替换执行实例 | 检查点、重复执行和结果去重 |
| 需要可重复的客户环境 | 声明式部署配置 | 升级、迁移、备份与恢复演练 |

因此，建议先把业务 API 与计算执行分开，并定义统一 Run 协议。底层从单机 Worker 换成 K8s Job 时，前端仍提交同一种任务，也仍通过平台查询结果。

## 2. 先区分平台控制服务与计算执行

这里的“平台控制服务”指 FastAPI、任务记录与执行适配器；Kubernetes 自身的控制平面则包含 API Server、调度器和控制器，两者不是同一层。

{{< mermaid >}}
flowchart TD
    U[React 工作台] --> A[FastAPI 身份校验与业务授权]
    A --> D[(PostgreSQL 元数据与 Run)]
    A -->|同事务记录提交意图| D
    D --> R[执行适配器与状态对账]
    R --> K[Kubernetes API]
    K --> C[CPU Job 清洗与切分]
    K --> G[GPU Job 打标与 Embedding]
    C -->|读取与暂存| S[(对象存储)]
    G -->|读取与暂存| S
    R --> V[结果清单校验与提交]
    S --> V
    V --> D
    V --> I[版本化数据集与索引发布]
{{< /mermaid >}}

建议明确三类职责：

- **业务 API**：验证用户、项目、输入资产和算子权限，冻结执行配置，创建 Run 并返回 ID。
- **执行适配器**：把受控算子声明转成 Job，保存集群对象身份，处理取消、重试与状态对账。
- **Worker**：处理一个逻辑分片，读取授权数据，写暂存产物并生成 manifest，不直接修改业务授权或宣布全量数据集可用。

API 应先在数据库事务中保存 Run 和待提交记录，再由适配器领取。否则“数据库写成功、创建 Job 超时”就可能留下永远不运行的任务；反过来则可能留下没有业务记录的作业。

适配器用确定性的 Job 名称关联 `run_id + step + shard + execution_generation`。创建请求超时后先查询对象并校验身份，不立即换名字再提交。数据库还应保存 Job UID，避免同名对象被重新创建后混淆。这里的持久化提交意图与对账机制需要由平台实现。

## 3. Data Flywheel 的组件如何映射到 K8s

| 平台组件 | 建议承载方式 | 设计关注点 |
| --- | --- | --- |
| Vite 构建后的前端 | 静态托管，或静态服务器 Deployment + Service | SPA 路由回退、API 地址与缓存 |
| FastAPI | Deployment + Service | 共享数据库、会话、探针与滚动升级 |
| 任务适配器 | 独立 Deployment | 事务领取、租约或锁、重复提交处理 |
| 有明确结束条件的 CPU/GPU 算子 | Job | 分片、资源、截止时间与重试 |
| 高频且加载模型昂贵的推理 | 长驻 Deployment + Service | 模型预热、批推理、请求背压 |
| 定期启动的数据核对任务 | CronJob | 时间窗口、重入与去重 |
| PostgreSQL、对象存储、索引 | 起步可使用集群外服务 | 备份、容量、版本与访问边界 |

Deployment 适合维护指定数量的服务副本，并支持滚动更新。副本数增加前仍要检查应用是否依赖本地状态。参见 [Kubernetes Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)。

数据库放进 StatefulSet 可以获得稳定身份等运行机制，但数据复制、故障切换和恢复策略还需要数据库自身及运维体系支持。对当前平台，先使用已有可靠数据库服务通常更容易控制建设范围。

另外，前文 [Operator as Plugin]({{< relref "/posts/ai-data/data-platform/operator-as-plugin/index.md" >}}) 的 Operator 指数据处理算子；Kubernetes Operator 指通过控制器管理应用生命周期的扩展模式。注册一个切分插件并不要求为它创建 CRD。可以先使用原生 Job，只有出现稳定、重复的领域运维需求时再评估自定义控制器。参见 [Kubernetes Operator 模式](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/)。

## 4. 当前 API 上集群前要补齐什么

本次阅读 `apps/api/app/config.py`、`main.py`、`database.py` 和 `auth.py`，有几处直接影响部署设计。

### 4.1 数据库初始化应退出普通副本启动流程

当前 lifespan 会执行数据库初始化与种子数据写入，`init_database()` 使用 `Base.metadata.create_all()`。多个副本一起启动时，这种开发便利需要重新审视：建表并不等于版本化迁移，初始化也不能依赖各副本启动顺序。

建议将数据库迁移作为发布中的独立步骤，使用并发保护与可追踪版本；生产种子数据单独管理。迁移成功后再放行兼容的 API 版本。默认 SQLite 配置则应替换为目标 PostgreSQL 配置，并验证事务、连接池与恢复。

### 4.2 共享会话已有基础，仍需验证多副本行为

当前认证代码使用数据库中的 `SessionRecord`，有利于不同 API 副本读取同一会话。上线演练仍要覆盖登录回调、CSRF、会话轮换、权限撤销，以及滚动升级中的新旧版本兼容。

配置层已有生产校验：要求 OIDC、非默认客户端密钥和安全 Cookie。部署时还要正确设置外部前端地址、OIDC issuer 与回调地址，保证浏览器和服务端都能通过预期网络路径访问它们。

### 4.3 `/health` 不能证明请求链路可用

当前 `/health` 返回状态、服务名和认证模式，没有执行数据库连通性检查。建议新增职责明确的探针端点：

- **startup**：初始化完成前允许较长启动窗口，尤其是模型服务预热阶段。
- **readiness**：判断该副本能否接收业务流量，必要依赖检查应有短超时。
- **liveness**：判断进程是否失去自行恢复能力，避免数据库短暂故障导致所有副本反复重启。

readiness 失败会使 Pod 从对应 Service 的可用端点中移出，liveness/startup 连续失败可触发容器重启。探针的职责区别见 [Kubernetes 探针文档](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)。

这些是后续改造建议；本文没有向当前 API 添加探针、迁移工具或集群配置。

## 5. 用一条视频流水线解释任务粒度

以“视频质检 → 镜头切分 → Embedding → 索引发布”为例，建议按资源和数据依赖拆分：

| 步骤 | 执行策略 | 完成依据 |
| --- | --- | --- |
| 质检与切分 | CPU Job，按视频批次分片 | 片段清单、时间区间和质量记录通过校验 |
| Embedding | GPU Job，批量读取片段 | 向量数量、维度与向量空间版本符合约定 |
| 索引构建 | 独立任务，限制读写并发 | 输入水位、数量与检索回归通过 |
| 数据发布 | 平台元数据提交 | 数据集与模型／索引组合进入可用状态 |

分片过小会把时间花在创建 Pod、拉镜像和加载模型上；过大则会放大单次失败损失。应通过真实样本测量解码、下载、推理和提交耗时，再决定每个 Job 处理多少视频分钟或片段。

如果模型加载时间接近甚至超过推理时间，可以使用长驻 Worker 消费分片；如果算法版本差异大、任务较长，独立 Job 更容易管理依赖。两种方式都需要同一套任务身份与提交协议。

人工审核阶段只保留持久化业务状态，用户提交结果后触发后续步骤，不需要让一个 Pod 为等待审核空转数天。

## 6. 一份 GPU Job 设计模板

下面展示**单个 Embedding 分片**的执行形态。镜像、命令和参数均为协议示例，Data Flywheel 当前没有该 Worker；替换占位符并实现对应程序后才能运行。

前提是已创建 `flywheel-compute` namespace、专用 ServiceAccount，以及有作用域限制的 `flywheel-run-storage` Secret；节点已安装匹配的驱动、容器运行环境和 NVIDIA device plugin，并设置模板使用的节点标签与污点。生产可进一步使用短期工作负载凭据。

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: embed-run-001-shard-000-g1
  namespace: flywheel-compute
  labels:
    app.kubernetes.io/name: flywheel-embedding
    flywheel.example.com/run-id: run-001
    flywheel.example.com/shard-id: "000"
spec:
  completions: 1
  parallelism: 1
  backoffLimit: 2
  activeDeadlineSeconds: 3600
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: flywheel-embedding
        flywheel.example.com/run-id: run-001
    spec:
      serviceAccountName: flywheel-worker
      automountServiceAccountToken: false
      restartPolicy: Never
      terminationGracePeriodSeconds: 60
      nodeSelector:
        flywheel.example.com/pool: gpu-batch
      tolerations:
        - key: flywheel.example.com/dedicated
          operator: Equal
          value: gpu-batch
          effect: NoSchedule
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        fsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: worker
          image: "registry.example.com/flywheel/embed@sha256:<digest>"
          command: ["python", "-m", "flywheel_worker"]
          args:
            - "--run-id=run-001"
            - "--shard-id=000"
            - "--input=s3://flywheel-input/snapshots/snapshot-017/shard-000.json"
            - "--output-root=s3://flywheel-staging/run-001/embed/000/"
          env:
            - name: ATTEMPT_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.uid
            - name: STORAGE_TOKEN
              valueFrom:
                secretKeyRef:
                  name: flywheel-run-storage
                  key: token
            - name: TMPDIR
              value: /scratch
          resources:
            requests:
              cpu: "4"
              memory: 16Gi
              ephemeral-storage: 20Gi
            limits:
              cpu: "8"
              memory: 24Gi
              ephemeral-storage: 40Gi
              nvidia.com/gpu: 1
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: scratch
              mountPath: /scratch
      volumes:
        - name: scratch
          emptyDir:
            sizeLimit: 30Gi
```

这些数值是容量规划的起点，不是通用推荐规格。镜像必须支持指定的非 root UID、只读根目录，并把模型缓存及临时写入指向可写挂载；`STORAGE_TOKEN` 也需要 Worker 的存储客户端实际支持。

模板约定 Worker 将 `ATTEMPT_ID` 追加到输出根路径，在各次 Pod 尝试之间隔离暂存结果。禁止挂载默认 API token，适用于本例通过独立存储凭据工作的方式；若改用工作负载身份，需要按身份提供方配置所需的投射 token。

`backoffLimit` 约束 Job 的失败重试，`activeDeadlineSeconds` 约束活动期限，TTL 用于完成后的对象清理。单完成 Job 仍可能重复启动程序，因此不能用 `parallelism: 1` 推导只执行一次。具体语义见 [Kubernetes Job](https://kubernetes.io/docs/concepts/workloads/controllers/job/)。

GPU 在 device plugin 路径下通过扩展资源申请；只写 GPU limit 时，request 默认采用相同值，若同时声明则必须相等。`nvidia.com/gpu: 1` 不是 1 GiB 显存配额，模型能否装入所选设备仍需单独验证。参见 [GPU 调度文档](https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/)。

## 7. 调度、排队与扩缩容分别解决什么

### 7.1 先给不同负载合适的资源池

建议从通用服务、CPU 批处理、GPU 批处理三类节点池起步；在线模型服务有稳定延迟要求时，再隔离其 GPU 资源。

节点选择规则表达“允许去哪里”，污点与容忍控制“哪些 Pod 可以进入”。**toleration 只是允许进入，不会强制 Pod 去某个节点**，因此示例同时使用 `nodeSelector`。参见 [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/)。

CPU/memory requests 是调度依据；CPU limit 可能导致节流，内存超过限制可能导致 OOM。视频解码和中间张量也消耗主机内存，不能只观察 GPU 显存。临时磁盘申请与限制应计入下载、解码、容器日志等开销。参见 [容器资源管理](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)。

### 7.2 业务队列不等于 Pod 调度器

K8s 调度器选择 Pod 的运行节点；平台还要决定哪个项目的哪批任务先获得运行资格。任务量较小时，可以先限制每个项目的活动作业数，不必一次引入完整批调度体系。

当多项目 GPU 竞争成为实际问题，可以评估 Kueue：它负责作业准入、配额和相关排队策略，不替代 kube-scheduler，也不编排“切分完成后才能向量化”的数据依赖。参见 [Kueue 官方概览](https://kueue.sigs.k8s.io/docs/overview/)。

平台仍需冻结流水线版本，记录每步输出并驱动后继步骤。未来接入专门的工作流引擎时，也应明确哪一层负责重试，防止平台、编排器和 Job 各自重试，最终放大重复计算。

### 7.3 增加 Pod 不会自动增加 GPU 节点

HPA 面向服务副本，根据资源或自定义指标调整规模；节点扩容由另一层能力负责。参见 [Kubernetes 工作负载自动扩缩容](https://kubernetes.io/docs/concepts/workloads/autoscaling/)。

对 Data Flywheel，建议 API 观察请求延迟与并发，长驻 Worker 观察队列等待时间和处理速率，批 Job 通过准入和并发上限控制数量。索引写入和对象存储带宽达到瓶颈时，应降低上游并发，而不是继续增加 GPU Pod。

## 8. K8s 成功状态如何变成业务成功

Pod 退出码为 0，只能说明进程按其定义成功结束；它不能证明产物数量正确、模型版本匹配或数据已对外发布。建议平台使用独立状态机：

```text
queued → submitted → running → validating → succeeded
                      ↘ failed
queued / submitted / running → cancel_requested → cancelled
```

`submitted` 包含已创建 Job 但尚未获得节点的阶段，界面可进一步显示等待配额、拉取镜像或等待资源。只有结果校验并完成提交后才进入 `succeeded`。

沿用插件文章的幂等协议，平台为每个逻辑分片固定输入快照、算子镜像摘要、参数和模型修订。Worker 写独立 attempt 目录；校验器核对 manifest 中的文件、校验和、数量、Schema 和向量空间；数据库再通过唯一键或条件更新选出获胜提交。

| 故障窗口 | 对账或恢复方式 |
| --- | --- |
| 创建 Job 成功，但应答丢失 | 用确定名称查询并验证 UID 与执行身份 |
| 文件写完后 Worker 失联 | 检查已有 manifest，允许校验或重试，暂存物不直接对外可见 |
| Job 完成，但结果数量不符 | 进入校验失败，阻止数据集与索引发布 |
| 元数据提交成功，但确认丢失 | 查询既有提交，不再次发布相同逻辑分片 |
| 用户取消时恰好完成提交 | 用条件状态更新裁决；已提交成功的结果按既定策略保留 |
| Job 已被 TTL 清理 | 从平台保留的终态、日志和 manifest 查询历史 |

取消请求应先持久化，再停止新分片并终止受控执行；确认停止后才能显示 `cancelled`。Worker 收到 SIGTERM 时可尝试保存检查点，但节点突然丢失不会提供这一机会，检查点必须定期持久化。

API watch 可以加快状态同步，定期 list 与数据库对账则用于弥补进程重启、断线和事件丢失。集群对象是执行状态来源之一，业务历史仍应保存在平台自己的元数据中。

## 9. 数据、身份与租户边界

### 9.1 大文件走对象存储，临时盘只做缓存

建议数据库保存资产身份、版本、Run 与血缘，对象存储保存原始视频、派生片段和结果文件，节点本地盘用于可重建缓存。输入清单只传引用，避免把大批视频塞进 API 请求、ConfigMap 或 Job 参数。

`emptyDir` 随 Pod 生命周期存在；容器重启与 Pod 被替换是不同情况，Pod 被移除后其中数据不能作为恢复依据。需要跨 Pod 保留的数据，应进入对象存储或合适的持久卷。参见 [Kubernetes Volumes](https://kubernetes.io/docs/concepts/storage/volumes/)。

对于不可变输入，缓存键至少覆盖对象版本或校验和；可变路径的同名文件不能直接复用旧缓存。读取吞吐、对象请求数和临时盘占用应与 GPU 指标一起观察。

### 9.2 业务权限与集群权限各守一层

Keycloak 与 PyCasbin 继续决定用户能否处理某项目的数据；K8s RBAC 决定某个 ServiceAccount 能否创建或读取 Job。两者不能互相代替。

建议仅执行适配器拥有限定 namespace 的必要 Job/Pod 操作权限，Worker 默认没有创建作业权限。平台接受受控的资源档位、镜像与参数，不把用户输入的任意 PodSpec 原样提交给集群。能够创建 Pod 本身就是强权限，应同时限制可选账号、Secret 引用、挂载与运行安全配置。

Namespace 需要配套 RBAC、ResourceQuota 和网络策略才能构成有效隔离的一部分；NetworkPolicy 是否生效依赖网络插件支持。参见 [Kubernetes 多租户文档](https://kubernetes.io/docs/concepts/security/multi-tenancy/)。

对当前平台，建议先按环境和信任边界规划 namespace，另以业务字段保留项目身份。对象存储读写范围、索引过滤、短期下载授权仍由平台落实；单独添加 `tenant_id` 标签不会限制文件访问。面对不可信插件或更强隔离要求，应评估独立节点、沙箱运行时或独立集群。

## 10. 从一个可验证闭环开始上线

建议把 K8s 建设拆成三步，每步都有可以观察的结果。

1. **服务部署**：固化前后端镜像与配置，完成生产认证、数据库迁移和探针；验证登录请求跨副本、滚动发布及数据库恢复。
2. **单流水线执行**：实现 Run、执行适配器、一个 CPU 算子和一个 GPU 算子；冻结输入并校验结果，打通取消、幂等提交和状态对账。
3. **资源治理**：用真实负载测量后，再加入队列配额、节点扩容、更多插件及专门的工作流能力。

最小验收应包含以下故障演练，而不只检查 Deployment 是否 Ready：

| 演练 | 预期结果 |
| --- | --- |
| GPU Worker 运行中被终止 | 能重试或明确失败，没有重复发布 |
| 适配器在创建 Job 后重启 | Run 可恢复对账，不出现多份独立作业 |
| GPU 资源不足 | 任务显示可解释的等待原因，普通 API 仍可用 |
| 对象存储写入失败 | 输出保持未发布，下游索引不接收半成品 |
| 尝试读取其他项目资产 | 即使知道对象路径也无法越权读取 |
| 更新 API，同时存在旧 Worker | 已运行任务继续遵守冻结版本的契约 |

观测至少覆盖 API 延迟、排队时间、分片吞吐、重试率、GPU 使用率、暂存存储增长和数据校验失败。日志关联 `run_id / step / shard / attempt / job_uid`；这些高基数字段适合日志与追踪，监控指标标签则宜保留项目、算子、资源池等有限维度。

成本可以先用“每千分钟视频的 GPU 小时”和“每千个成功片段的总成本”衡量，将失败重试、加载模型与数据搬运纳入计算。这样才能判断扩容是否改善了数据交付，而不只是让集群看起来更忙。

这条路线与 [技术框架选型]({{< relref "/posts/ai-data/data-platform/technology-stack/index.md" >}})、[插件执行协议]({{< relref "/posts/ai-data/data-platform/operator-as-plugin/index.md" >}})、[权限管理]({{< relref "/posts/ai-data/data-platform/access-control/index.md" >}}) 和 [发布环境管理]({{< relref "/posts/ai-data/data-platform/release-environments/index.md" >}}) 共同构成 Data Flywheel 的落地约束：服务能稳定运行，任务能恢复，最终交付的数据有明确版本和可信来源。
